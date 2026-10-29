import net from 'node:net'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import {
  applyScale,
  bufferToWords,
  decodeBytes,
  encodeBytes,
  registerCount,
  toBoolean,
  withTimeout,
} from './util.ts'

// 三菱 MC 协议 3E 帧（二进制），适用于 Q/L/iQ-F 等 PLC
// 参考：MELSEC 通信协议参考手册 SLMP (Seamless Message Protocol)

const HEADER_LENGTH = 11 // 响应帧固定头部长度（Subheader 2 + Network/PC/IO/Station 5 + DataLength 2 + EndCode 2）

const DEVICE_CODES: Record<string, number> = {
  SM: 0x91,
  SD: 0xa9,
  X: 0x9d,
  Y: 0x9e,
  M: 0x90,
  L: 0x92,
  F: 0x93,
  V: 0x94,
  B: 0xa0,
  W: 0xb4,
  S: 0x98,
  D: 0xa8,
  R: 0xaf,
  ZR: 0xb0,
}

function parseDeviceAddress(address: string) {
  const trimmed = address.trim().toUpperCase()
  const match = trimmed.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`无效 MC 地址 ${address}`)
  const [, prefix, num] = match
  const code = DEVICE_CODES[prefix]
  if (code === undefined) throw new Error(`不支持的 MC 软元件 ${prefix}`)
  return { code, number: Number.parseInt(num, 10), prefix }
}

function buildFrame(command: number, subcommand: number, data: Buffer) {
  // 请求帧头部：Subheader(50 00) + Network No + PC No + Unit I/O No(FF 03) + Unit Station No + DataLength
  const header = Buffer.from([0x50, 0x00, 0x00, 0xff, 0xff, 0x03, 0x00])
  const dataLength = 2 + 2 + 2 + data.length // Monitoring timer + command + subcommand + data
  const frame = Buffer.alloc(7 + 2 + dataLength)
  header.copy(frame)
  frame.writeUInt16LE(dataLength, 7)
  frame.writeUInt16LE(0x000a, 9) // 监控定时器 2500ms
  frame.writeUInt16LE(command, 11)
  frame.writeUInt16LE(subcommand, 13)
  data.copy(frame, 15)
  return frame
}

export class McProtocolDriver extends BaseDriver {
  private socket: net.Socket | null = null
  private connecting: Promise<void> | null = null
  private transactionId = 0

  get connected() {
    return Boolean(this.socket && !this.socket.destroyed && this.socket.readyState === 'open')
  }

  private async open() {
    const host = this.device.host
    const port = this.device.port || 5000
    if (!host) throw new Error('未配置 IP 地址')
    this.socket = net.createConnection({ host, port })
    this.socket.setTimeout(this.timeoutMs)
    this.socket.setNoDelay(true)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const socket = this.socket!
        const onConnect = () => {
          cleanup()
          resolve()
        }
        const onError = (err: Error) => {
          cleanup()
          reject(err)
        }
        const onTimeout = () => {
          cleanup()
          socket.destroy()
          reject(new Error('MC 连接超时'))
        }
        const cleanup = () => {
          socket.off('connect', onConnect)
          socket.off('error', onError)
          socket.off('timeout', onTimeout)
        }
        socket.once('connect', onConnect)
        socket.once('error', onError)
        socket.once('timeout', onTimeout)
      }),
      this.timeoutMs,
      `连接 ${host}:${port}`,
    )
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async exchange(req: Buffer): Promise<Buffer> {
    await this.connect()
    const socket = this.socket!
    this.transactionId += 1
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        let buffer = Buffer.alloc(0)
        const onData = (data: Buffer) => {
          buffer = Buffer.concat([buffer, data])
          if (buffer.length < HEADER_LENGTH) return
          const dataLength = buffer.readUInt16LE(7)
          const totalLength = HEADER_LENGTH + dataLength - 2 // dataLength 已包含 EndCode 2 字节
          if (buffer.length < totalLength) return
          cleanup()
          const response = buffer.subarray(0, totalLength)
          const endCode = response.readUInt16LE(9)
          if (endCode !== 0) {
            reject(new Error(`MC 响应错误码 0x${endCode.toString(16).padStart(4, '0')}`))
            return
          }
          resolve(response)
        }
        const onError = (err: Error) => {
          cleanup()
          reject(err)
        }
        const onClose = (hadError: boolean) => {
          cleanup()
          reject(hadError ? new Error('MC 连接异常关闭') : new Error('MC 连接已关闭'))
        }
        const onTimeout = () => {
          cleanup()
          socket.destroy()
          reject(new Error('MC 响应超时'))
        }
        const cleanup = () => {
          socket.off('data', onData)
          socket.off('error', onError)
          socket.off('close', onClose)
          socket.off('timeout', onTimeout)
        }
        socket.on('data', onData)
        socket.once('error', onError)
        socket.once('close', onClose)
        socket.once('timeout', onTimeout)
        socket.write(req, (err) => {
          if (err) {
            cleanup()
            reject(err)
          }
        })
      }),
      this.timeoutMs,
      '等待 MC 响应',
    )
  }

  async probe() {
    // 读取 D0 一个字作为探活
    const { code, number } = parseDeviceAddress('D0')
    const req = buildBatchReadWordRequest(code, number, 1)
    await this.exchange(req)
  }

  async readTag(tag: Tag) {
    const { code, number, prefix } = parseDeviceAddress(tag.address)
    if (tag.dataType === 'bool' || prefix === 'X' || prefix === 'Y' || prefix === 'M' || prefix === 'L' || prefix === 'B' || prefix === 'F' || prefix === 'V') {
      // 按位读取
      const req = buildBatchReadBitRequest(code, number, 1)
      const res = await this.exchange(req)
      const payload = res.subarray(HEADER_LENGTH)
      return (payload[0] & 0x01) !== 0
    }
    const words = registerCount(tag.dataType)
    const req = buildBatchReadWordRequest(code, number, words)
    const res = await this.exchange(req)
    const payload = res.subarray(HEADER_LENGTH)
    const raw = Buffer.alloc(words * 2)
    for (let i = 0; i < words; i += 1) {
      raw.writeUInt16LE(payload.readUInt16LE(i * 2), i * 2)
    }
    // MC 协议数据为小端字序
    const decoded = decodeBytes(raw, tag.dataType, tag.byteOrder, true)
    if (typeof decoded === 'number') return applyScale(decoded, tag.scale, tag.offset)
    return decoded
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    const { code, number, prefix } = parseDeviceAddress(tag.address)
    if (tag.dataType === 'bool' || prefix === 'X' || prefix === 'Y' || prefix === 'M' || prefix === 'L' || prefix === 'B' || prefix === 'F' || prefix === 'V') {
      const req = buildBatchWriteBitRequest(code, number, toBoolean(value))
      await this.exchange(req)
      return
    }
    const buf = encodeBytes(value, tag.dataType, tag.byteOrder, tag.scale, tag.offset, true)
    const values = bufferToWords(buf)
    const req = buildBatchWriteWordRequest(code, number, values)
    await this.exchange(req)
  }

  async close() {
    const socket = this.socket
    this.socket = null
    this.connecting = null
    if (!socket) return
    await new Promise<void>((resolve) => {
      const finish = () => resolve()
      const guard = setTimeout(finish, 1000)
      guard.unref()
      try {
        socket.once('close', finish)
        socket.end(finish)
        socket.destroy()
      } catch {
        finish()
      }
    })
  }
}

function buildBatchReadWordRequest(deviceCode: number, address: number, count: number) {
  const data = Buffer.alloc(6)
  data.writeUInt8(deviceCode, 0)
  data.writeUInt8(address & 0xff, 1)
  data.writeUInt8((address >> 8) & 0xff, 2)
  data.writeUInt8((address >> 16) & 0xff, 3)
  data.writeUInt16LE(count, 4)
  return buildFrame(0x0401, 0x0000, data)
}

function buildBatchReadBitRequest(deviceCode: number, address: number, count: number) {
  const data = Buffer.alloc(6)
  data.writeUInt8(deviceCode, 0)
  data.writeUInt8(address & 0xff, 1)
  data.writeUInt8((address >> 8) & 0xff, 2)
  data.writeUInt8((address >> 16) & 0xff, 3)
  data.writeUInt16LE(count, 4)
  return buildFrame(0x0401, 0x0001, data)
}

function buildBatchWriteWordRequest(deviceCode: number, address: number, values: number[]) {
  const data = Buffer.alloc(6 + values.length * 2)
  data.writeUInt8(deviceCode, 0)
  data.writeUInt8(address & 0xff, 1)
  data.writeUInt8((address >> 8) & 0xff, 2)
  data.writeUInt8((address >> 16) & 0xff, 3)
  data.writeUInt16LE(values.length, 4)
  for (let i = 0; i < values.length; i += 1) {
    data.writeUInt16LE(values[i] & 0xffff, 6 + i * 2)
  }
  return buildFrame(0x1401, 0x0000, data)
}

function buildBatchWriteBitRequest(deviceCode: number, address: number, value: boolean) {
  const data = Buffer.alloc(7)
  data.writeUInt8(deviceCode, 0)
  data.writeUInt8(address & 0xff, 1)
  data.writeUInt8((address >> 8) & 0xff, 2)
  data.writeUInt8((address >> 16) & 0xff, 3)
  data.writeUInt16LE(1, 4)
  data.writeUInt8(value ? 0x01 : 0x00, 6)
  return buildFrame(0x1401, 0x0001, data)
}
