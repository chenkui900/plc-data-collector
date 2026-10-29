import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { TcpTransport, type FrameMatcher } from './tcp.ts'
import { applyScale, decodeBytes, encodeBytes, registerCount, toBoolean } from './util.ts'

/**
 * 汇川 HCP 私有协议（TCP）
 *
 * ⚠ 帧结构说明：HCP 官方帧格式未公开，以下为按公开资料整理的帧结构，
 * 若与实际设备不符，只需修改本文件中的 buildRequest / parseResponse 两个函数。
 *
 * 请求帧：'HCP' | 版本(1) | 站号(1) | 命令(1) | 元件类型(1) | 地址(4,LE) | 数量(2,LE) | [数据]
 * 响应帧：'HCP' | 版本(1) | 站号(1) | 命令(1) | 错误码(2,LE) | 数据长度(2,LE) | 数据
 */
const MAGIC = Buffer.from([0x48, 0x43, 0x50]) // 'HCP'
const VERSION = 0x01
const CMD_READ = 0x01
const CMD_WRITE = 0x02
const REQUEST_HEADER_LENGTH = 13
const RESPONSE_HEADER_LENGTH = 10

const ELEMENT_TYPES: Record<string, number> = {
  D: 0x00,
  M: 0x01,
  X: 0x02,
  Y: 0x03,
  R: 0x04,
  ZR: 0x05,
  W: 0x06,
  S: 0x07,
  T: 0x08,
  C: 0x09,
}

const BIT_ELEMENTS = new Set(['M', 'X', 'Y', 'S'])

export function parseHcpAddress(address: string) {
  const raw = address.trim().toUpperCase()
  const match = raw.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`无效 HCP 地址 ${address}`)
  const type = ELEMENT_TYPES[match[1]]
  if (type === undefined) throw new Error(`不支持的 HCP 软元件 ${match[1]}`)
  return { element: match[1], type, number: Number.parseInt(match[2], 10) }
}

const hcpMatcher: FrameMatcher = (buf) => {
  if (buf.length < RESPONSE_HEADER_LENGTH) return null
  if (buf[0] !== MAGIC[0] || buf[1] !== MAGIC[1] || buf[2] !== MAGIC[2]) return null
  const dataLength = buf.readUInt16LE(8)
  const total = RESPONSE_HEADER_LENGTH + dataLength
  if (buf.length < total) return null
  return buf.subarray(0, total)
}

export class HcpError extends Error {
  constructor(public code: number) {
    super(`HCP 错误码 0x${code.toString(16)}`)
    this.name = 'HcpError'
  }
}

function buildRequest(command: number, station: number, element: number, address: number, count: number, data?: Buffer) {
  const frame = Buffer.alloc(REQUEST_HEADER_LENGTH + (data?.length ?? 0))
  MAGIC.copy(frame)
  frame[3] = VERSION
  frame[4] = station & 0xff
  frame[5] = command
  frame[6] = element & 0xff
  frame.writeUInt32LE(address, 7) // 元件地址（4 字节小端）
  frame.writeUInt16LE(count, 11) // 读取为元件数量，写入为数据字节数
  data?.copy(frame, REQUEST_HEADER_LENGTH)
  return frame
}

function parseResponse(frame: Buffer) {
  if (frame.length < RESPONSE_HEADER_LENGTH) throw new Error('HCP 响应过短')
  const errorCode = frame.readUInt16LE(6)
  if (errorCode !== 0) throw new HcpError(errorCode)
  const dataLength = frame.readUInt16LE(8)
  return frame.subarray(RESPONSE_HEADER_LENGTH, RESPONSE_HEADER_LENGTH + dataLength)
}

export class HcpDriver extends BaseDriver {
  private transport: TcpTransport

  constructor(device: Device) {
    super(device)
    this.transport = new TcpTransport(device.host ?? '', device.port || 5000, Math.max(500, device.timeout || 3000))
  }

  get connected() {
    return this.transport.connected
  }

  get station() {
    return this.device.slaveId || 1
  }

  async connect() {
    await this.transport.connect()
  }

  async probe() {
    await this.connect()
    try {
      await this.transport.request(buildRequest(CMD_READ, this.station, ELEMENT_TYPES.D, 0, 1), hcpMatcher)
    } catch (error) {
      if (error instanceof HcpError) return
      throw error
    }
  }

  async readTag(tag: Tag) {
    const { element, type, number } = parseHcpAddress(tag.address)
    const isBit = tag.dataType === 'bool' || BIT_ELEMENTS.has(element)
    if (isBit) {
      const response = await this.transport.request(buildRequest(CMD_READ, this.station, type, number, 1), hcpMatcher)
      const data = parseResponse(response)
      return (data[0] & 0x01) === 1
    }
    const words = registerCount(tag.dataType)
    const response = await this.transport.request(buildRequest(CMD_READ, this.station, type, number, words), hcpMatcher)
    const data = parseResponse(response)
    const buf = Buffer.alloc(words * 2)
    for (let i = 0; i < words; i += 1) {
      buf.writeUInt16LE(data.readUInt16LE(i * 2), i * 2)
    }
    // HCP 数据为小端字序
    const decoded = decodeBytes(buf, tag.dataType, tag.byteOrder, true)
    if (typeof decoded === 'number') return applyScale(decoded, tag.scale, tag.offset)
    return decoded
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    const { element, type, number } = parseHcpAddress(tag.address)
    const isBit = tag.dataType === 'bool' || BIT_ELEMENTS.has(element)
    if (isBit) {
      const payload = Buffer.from([toBoolean(value) ? 0x01 : 0x00])
      const response = await this.transport.request(
        buildRequest(CMD_WRITE, this.station, type, number, payload.length, payload),
        hcpMatcher,
      )
      parseResponse(response)
      return
    }
    const words = registerCount(tag.dataType)
    const buf = encodeBytes(value, tag.dataType, tag.byteOrder, tag.scale, tag.offset, true)
    const payload = Buffer.alloc(words * 2)
    buf.copy(payload, 0, 0, Math.min(buf.length, words * 2))
    const response = await this.transport.request(
      buildRequest(CMD_WRITE, this.station, type, number, payload.length, payload),
      hcpMatcher,
    )
    parseResponse(response)
  }

  async close() {
    await this.transport.close()
  }
}
