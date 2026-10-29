import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { TcpTransport, type FrameMatcher } from './tcp.ts'
import { applyScale, toBoolean } from './util.ts'

// EtherNet/IP (CIP) 非连接显式报文：RegisterSession + SendRRData + CIP 标签读写
const CMD_REGISTER_SESSION = 0x0065
const CMD_SEND_RR_DATA = 0x006f

const TYPE_CODES: Record<string, number> = {
  bool: 0x00c1,
  int16: 0x00c3,
  uint16: 0x00c3,
  word: 0x00c3,
  int32: 0x00c4,
  uint32: 0x00c4,
  dword: 0x00c4,
  float32: 0x00ca,
  float64: 0x00cb,
  string: 0x00da,
}

const enipMatcher: FrameMatcher = (buf) => {
  if (buf.length < 24) return null
  const length = buf.readUInt16LE(2)
  if (buf.length < 24 + length) return null
  return buf.subarray(0, 24 + length)
}

export class CipError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'CipError'
  }
}

function buildEnipHeader(command: number, session: number, data: Buffer) {
  const header = Buffer.alloc(24)
  header.writeUInt16LE(command, 0)
  header.writeUInt16LE(data.length, 2)
  header.writeUInt32LE(session, 4)
  header.writeUInt32LE(0, 8) // status
  // sender context 8 字节保持为 0
  header.writeUInt32LE(0, 20) // options
  return Buffer.concat([header, data])
}

/** 生成 CIP 符号标签路径（支持 Program:Main.Tag 这类多级名） */
function buildSymbolicPath(tagName: string) {
  const parts = tagName.split('.').filter(Boolean)
  const segments: Buffer[] = []
  for (const part of parts) {
    const name = Buffer.from(part, 'utf8')
    const padded = Buffer.alloc(name.length + (name.length % 2))
    name.copy(padded)
    segments.push(Buffer.concat([Buffer.from([0x91, name.length]), padded]))
  }
  const path = Buffer.concat(segments)
  return { path, pathSize: path.length / 2 }
}

export class EnipDriver extends BaseDriver {
  private transport: TcpTransport
  private session = 0

  constructor(device: Device) {
    super(device)
    this.transport = new TcpTransport(device.host ?? '', device.port || 44818, Math.max(500, device.timeout || 3000))
  }

  get connected() {
    return this.transport.connected && this.session !== 0
  }

  async connect() {
    if (this.session) return
    await this.transport.connect()
    const request = buildEnipHeader(CMD_REGISTER_SESSION, 0, Buffer.from([0x01, 0x00, 0x00, 0x00]))
    const response = await this.transport.request(request, enipMatcher)
    const status = response.readUInt32LE(8)
    if (status !== 0) throw new Error(`EtherNet/IP 注册会话失败 (status ${status})`)
    this.session = response.readUInt32LE(4)
  }

  private async sendRRData(cip: Buffer) {
    const inner = Buffer.concat([
      Buffer.alloc(4), // interface handle
      Buffer.alloc(2), // timeout
      (() => {
        const b = Buffer.alloc(2)
        b.writeUInt16LE(2, 0)
        return b
      })(), // item count
      (() => {
        const b = Buffer.alloc(4)
        b.writeUInt16LE(0x0000, 0) // null address item
        b.writeUInt16LE(0, 2)
        return b
      })(),
      (() => {
        const b = Buffer.alloc(4)
        b.writeUInt16LE(0x00b2, 0) // unconnected data item
        b.writeUInt16LE(cip.length, 2)
        return b
      })(),
      cip,
    ])
    const response = await this.transport.request(buildEnipHeader(CMD_SEND_RR_DATA, this.session, inner), enipMatcher)
    const status = response.readUInt32LE(8)
    if (status !== 0) throw new Error(`EtherNet/IP 传输失败 (status ${status})`)
    const data = response.subarray(24)
    // 定位 unconnected data item
    const itemType = data.readUInt16LE(16)
    const itemLength = data.readUInt16LE(18)
    if (itemType !== 0x00b2) throw new Error('EtherNet/IP 响应缺少 CIP 数据项')
    const cipResponse = data.subarray(20, 20 + itemLength)
    const generalStatus = cipResponse[2]
    if (generalStatus !== 0) throw new CipError(generalStatus, `CIP 状态 0x${generalStatus.toString(16)}`)
    return cipResponse.subarray(4 + (cipResponse[3] * 2))
  }

  async probe() {
    // 能完成 RegisterSession 即认为链路与 CIP 栈可用
    await this.connect()
  }

  async readTag(tag: Tag) {
    await this.connect()
    const { path, pathSize } = buildSymbolicPath(tag.address)
    const countBuf = Buffer.alloc(2)
    countBuf.writeUInt16LE(1, 0)
    const cip = Buffer.concat([Buffer.from([0x4c, pathSize]), path, countBuf])
    const data = await this.sendRRData(cip)
    const typeCode = data.readUInt16LE(0)
    const payload = data.subarray(2)
    switch (typeCode) {
      case 0x00c1:
        return payload[0] !== 0
      case 0x00c2:
        return payload.readInt8(0)
      case 0x00c3:
        return tag.dataType === 'int16' ? payload.readInt16LE(0) : payload.readUInt16LE(0)
      case 0x00c4:
      case 0x00d3: {
        const raw = tag.dataType === 'int32' ? payload.readInt32LE(0) : payload.readUInt32LE(0)
        return applyScale(raw, tag.scale, tag.offset)
      }
      case 0x00c5:
        return Number(payload.readBigInt64LE(0))
      case 0x00ca:
        return applyScale(payload.readFloatLE(0), tag.scale, tag.offset)
      case 0x00cb:
        return applyScale(payload.readDoubleLE(0), tag.scale, tag.offset)
      case 0x00da: {
        const length = payload.readUInt16LE(0)
        return payload.subarray(2, 2 + length).toString('utf8')
      }
      default:
        return applyScale(payload.readUInt16LE(0), tag.scale, tag.offset)
    }
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    const { path, pathSize } = buildSymbolicPath(tag.address)
    const typeCode = TYPE_CODES[tag.dataType] ?? 0x00c4
    const typeBuf = Buffer.alloc(2)
    typeBuf.writeUInt16LE(typeCode, 0)
    const countBuf = Buffer.alloc(2)
    countBuf.writeUInt16LE(1, 0)
    const payload = this.encodeValue(tag, value)
    const cip = Buffer.concat([Buffer.from([0x4d, pathSize]), path, typeBuf, countBuf, payload])
    await this.sendRRData(cip)
  }

  private encodeValue(tag: Tag, value: string | number | boolean) {
    const numeric = typeof value === 'number' ? value : Number(value)
    switch (tag.dataType) {
      case 'bool': {
        const buf = Buffer.alloc(2)
        buf.writeUInt16LE(toBoolean(value) ? 1 : 0, 0)
        return buf
      }
      case 'int16':
      case 'uint16':
      case 'word': {
        const buf = Buffer.alloc(2)
        buf.writeUInt16LE(Math.trunc(numeric) & 0xffff, 0)
        return buf
      }
      case 'int32':
      case 'uint32':
      case 'dword': {
        const buf = Buffer.alloc(4)
        buf.writeInt32LE(Math.trunc(numeric), 0)
        return buf
      }
      case 'float32': {
        const buf = Buffer.alloc(4)
        buf.writeFloatLE(numeric, 0)
        return buf
      }
      case 'float64': {
        const buf = Buffer.alloc(8)
        buf.writeDoubleLE(numeric, 0)
        return buf
      }
      case 'string': {
        const text = Buffer.from(String(value), 'utf8')
        const buf = Buffer.alloc(2 + text.length)
        buf.writeUInt16LE(text.length, 0)
        text.copy(buf, 2)
        return buf
      }
      default: {
        const buf = Buffer.alloc(4)
        buf.writeInt32LE(Math.trunc(numeric), 0)
        return buf
      }
    }
  }

  async close() {
    this.session = 0
    await this.transport.close()
  }
}
