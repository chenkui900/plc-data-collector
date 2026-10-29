import net from 'node:net'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { toBoolean, withTimeout } from './util.ts'

// IEC 60870-5-104 主站：STARTDT + 总召唤 + ASDU 数据缓存 + 单点/设定值命令
const STARTDT_ACT = Buffer.from([0x68, 0x04, 0x07, 0x00, 0x00, 0x00])
const TYPE_M_SP_NA_1 = 1 // 单点信息
const TYPE_M_DP_NA_1 = 3 // 双点信息
const TYPE_M_ME_NA_1 = 9 // 归一化测量值
const TYPE_M_ME_NB_1 = 11 // 标度化测量值
const TYPE_M_ME_NC_1 = 13 // 短浮点测量值
const TYPE_M_IT_NA_1 = 15 // 累计量
const TYPE_C_SC_NA_1 = 45 // 单点命令
const TYPE_C_SE_NC_1 = 50 // 短浮点设定值

interface CachedValue {
  value: number | boolean
  quality: number
}

function encodeShortFloat(value: number) {
  const buf = Buffer.alloc(4)
  let exponent = 0
  if (value !== 0) {
    exponent = Math.max(-128, Math.min(127, Math.floor(Math.log10(Math.abs(value))) - 6))
  }
  const mantissa = value / Math.pow(10, exponent)
  const sign = mantissa < 0 ? 1 : 0
  const abs = Math.min(0x7fffff, Math.round(Math.abs(mantissa)))
  const raw = (sign << 23) | abs
  buf[0] = (raw >> 16) & 0xff
  buf[1] = (raw >> 8) & 0xff
  buf[2] = raw & 0xff
  buf.writeInt8(exponent, 3)
  return buf
}

function decodeShortFloat(buf: Buffer) {
  const raw = (buf[0] << 16) | (buf[1] << 8) | buf[2]
  const sign = (raw >> 23) & 0x01
  const mantissa = sign === 1 ? -(raw & 0x7fffff) : raw & 0x7fffff
  return mantissa * Math.pow(10, buf.readInt8(3))
}

export class Iec104Driver extends BaseDriver {
  private socket: net.Socket | null = null
  private buffer = Buffer.alloc(0)
  private sendSeq = 0
  private recvSeq = 0
  private cache = new Map<number, CachedValue>()
  private startDtResolved: (() => void) | null = null

  get connected() {
    return Boolean(this.socket && !this.socket.destroyed && this.socket.readyState === 'open')
  }

  get commonAddress() {
    return this.device.slaveId || 1
  }

  async connect() {
    if (this.connected) return
    if (!this.device.host) throw new Error('未配置 IP 地址')
    const socket = net.createConnection({ host: this.device.host, port: this.device.port || 2404 })
    socket.setTimeout(this.timeoutMs)
    socket.setNoDelay(true)
    this.socket = socket
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('error', () => undefined)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          cleanup()
          resolve()
        }
        const onError = (err: Error) => {
          cleanup()
          reject(err)
        }
        const cleanup = () => {
          socket.off('connect', onConnect)
          socket.off('error', onError)
        }
        socket.once('connect', onConnect)
        socket.once('error', onError)
      }),
      this.timeoutMs,
      'IEC104 连接',
    )
  }

  async probe() {
    await this.connect()
    await this.startDataTransfer()
  }

  private async startDataTransfer() {
    const socket = this.socket
    if (!socket) throw new Error('未连接')
    await withTimeout(
      new Promise<void>((resolve) => {
        this.startDtResolved = resolve
        socket.write(STARTDT_ACT)
      }),
      this.timeoutMs,
      'STARTDT 确认',
    )
    // 总召唤，等待数据回传
    this.sendAsdu(this.buildGeneralInterrogation())
    await new Promise((resolve) => setTimeout(resolve, Math.min(1500, this.timeoutMs)))
  }

  private buildGeneralInterrogation() {
    return Buffer.concat([
      Buffer.from([100, 0x01]), // C_IC_NA_1(100)，1 个信息对象
      Buffer.from([0x06, 0x00]), // 传输原因：激活
      this.commonAddressBuffer(),
      Buffer.from([0x00, 0x00, 0x00]), // 信息对象地址 0
      Buffer.from([0x14]), // QOI = 20 总召唤
    ])
  }

  private commonAddressBuffer() {
    const buf = Buffer.alloc(2)
    buf.writeUInt16LE(this.commonAddress & 0xffff, 0)
    return buf
  }

  private sendAsdu(asdu: Buffer) {
    const socket = this.socket
    if (!socket) throw new Error('未连接')
    const control = Buffer.alloc(4)
    control[0] = (this.sendSeq << 1) & 0xfe
    control[1] = (this.sendSeq >> 7) & 0xff
    control[2] = (this.recvSeq << 1) & 0xfe
    control[3] = (this.recvSeq >> 7) & 0xff
    const apci = Buffer.alloc(2)
    apci[0] = 0x68
    apci[1] = 4 + asdu.length
    this.sendSeq = (this.sendSeq + 1) & 0x7fff
    socket.write(Buffer.concat([apci, control, asdu]))
  }

  private sendSFrame() {
    const socket = this.socket
    if (!socket) return
    const frame = Buffer.alloc(6)
    frame[0] = 0x68
    frame[1] = 0x04
    frame[2] = 0x01
    frame[3] = 0x00
    frame[4] = (this.recvSeq << 1) & 0xfe
    frame[5] = (this.recvSeq >> 7) & 0xff
    socket.write(frame)
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 6) {
      if (this.buffer[0] !== 0x68) {
        this.buffer = this.buffer.subarray(1)
        continue
      }
      const length = this.buffer[1]
      if (this.buffer.length < 2 + length) break
      const frame = this.buffer.subarray(0, 2 + length)
      this.buffer = this.buffer.subarray(2 + length)
      this.handleFrame(frame)
    }
  }

  private handleFrame(frame: Buffer) {
    const ctrl1 = frame[2]
    const type = ctrl1 & 0x03
    if (type === 0x03) {
      // U 帧
      if ((ctrl1 & 0xfc) === 0x0b && this.startDtResolved) {
        const resolve = this.startDtResolved
        this.startDtResolved = null
        resolve()
      }
      return
    }
    if (type === 0x01) return // S 帧
    // I 帧
    this.recvSeq = (this.recvSeq + 1) & 0x7fff
    this.sendSFrame()
    const asdu = frame.subarray(6)
    this.parseAsdu(asdu)
  }

  private parseAsdu(asdu: Buffer) {
    if (asdu.length < 6) return
    const typeId = asdu[0]
    const vsq = asdu[1]
    const count = vsq & 0x7f
    const sq = (vsq & 0x80) !== 0
    let offset = 2 + 2 + 2 // 传输原因(2) + 公共地址(2)
    let ioa = 0
    for (let i = 0; i < count; i += 1) {
      if (!sq || i === 0) {
        if (asdu.length < offset + 3) return
        ioa = asdu[offset] | (asdu[offset + 1] << 8) | (asdu[offset + 2] << 16)
        offset += 3
      } else {
        ioa += 1
      }
      switch (typeId) {
        case TYPE_M_SP_NA_1: {
          if (asdu.length < offset + 1) return
          const byte = asdu[offset]
          this.cache.set(ioa, { value: (byte & 0x01) === 1, quality: byte >> 1 })
          offset += 1
          break
        }
        case TYPE_M_DP_NA_1: {
          if (asdu.length < offset + 1) return
          const byte = asdu[offset]
          this.cache.set(ioa, { value: (byte & 0x03) === 2, quality: byte >> 2 })
          offset += 1
          break
        }
        case TYPE_M_ME_NA_1: {
          if (asdu.length < offset + 3) return
          const raw = asdu.readInt16LE(offset)
          this.cache.set(ioa, { value: raw / 32767, quality: asdu[offset + 2] })
          offset += 3
          break
        }
        case TYPE_M_ME_NB_1: {
          if (asdu.length < offset + 3) return
          this.cache.set(ioa, { value: asdu.readInt16LE(offset), quality: asdu[offset + 2] })
          offset += 3
          break
        }
        case TYPE_M_ME_NC_1: {
          if (asdu.length < offset + 5) return
          this.cache.set(ioa, { value: decodeShortFloat(asdu.subarray(offset, offset + 4)), quality: asdu[offset + 4] })
          offset += 5
          break
        }
        case TYPE_M_IT_NA_1: {
          if (asdu.length < offset + 5) return
          this.cache.set(ioa, { value: asdu.readInt32LE(offset), quality: asdu[offset + 4] })
          offset += 5
          break
        }
        default:
          return
      }
    }
  }

  private parseIoa(address: string) {
    const raw = address.trim()
    const parts = raw.split(':')
    const ioa = Number.parseInt(parts[parts.length - 1], 10)
    if (Number.isNaN(ioa)) throw new Error(`无效 IEC104 地址 ${address}`)
    return ioa
  }

  async readTag(tag: Tag) {
    await this.connect()
    if (!this.startDtResolved && this.cache.size === 0) await this.startDataTransfer()
    const ioa = this.parseIoa(tag.address)
    const cached = this.cache.get(ioa)
    if (!cached) throw new Error(`尚未收到 IOA ${ioa} 的数据`)
    return cached.value
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    const ioa = this.parseIoa(tag.address)
    const ioaBuf = Buffer.alloc(3)
    ioaBuf[0] = ioa & 0xff
    ioaBuf[1] = (ioa >> 8) & 0xff
    ioaBuf[2] = (ioa >> 16) & 0xff
    if (tag.dataType === 'bool') {
      const sco = toBoolean(value) ? 0x01 : 0x00
      this.sendAsdu(Buffer.concat([
        Buffer.from([TYPE_C_SC_NA_1, 0x01]),
        Buffer.from([0x06, 0x00]),
        this.commonAddressBuffer(),
        ioaBuf,
        Buffer.from([sco]),
      ]))
      return
    }
    const numeric = typeof value === 'number' ? value : Number(value)
    this.sendAsdu(Buffer.concat([
      Buffer.from([TYPE_C_SE_NC_1, 0x01]),
      Buffer.from([0x06, 0x00]),
      this.commonAddressBuffer(),
      ioaBuf,
      encodeShortFloat(numeric),
      Buffer.from([0x00]), // QOS
    ]))
  }

  async close() {
    const socket = this.socket
    this.socket = null
    this.cache.clear()
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
