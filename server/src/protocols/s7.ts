import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { TcpTransport, tpktMatcher } from './tcp.ts'
import { applyScale, decodeBytes, encodeBytes, registerCount, toBoolean } from './util.ts'

// Siemens S7comm over ISO-on-TCP (RFC1006)，适用于 S7-300/400/1200/1500
const AREA: Record<string, number> = {
  I: 0x81, // 输入
  Q: 0x82, // 输出
  M: 0x83, // 内部标志位
  DB: 0x84, // 数据块
  C: 0x1c, // 计数器
  T: 0x1d, // 定时器
}

interface S7Address {
  area: number
  db: number
  byteOffset: number
  bit: number | null
}

export function parseS7Address(address: string): S7Address {
  const raw = address.trim().toUpperCase().replace(/\s/g, '')
  const parts = raw.split('.')
  const headMatch = parts[0].match(/^([A-Z]+)(\d*)$/)
  if (!headMatch) throw new Error(`无效 S7 地址 ${address}`)
  let letters = headMatch[1]
  const headNumber = headMatch[2] ? Number.parseInt(headMatch[2], 10) : 0

  let db = 0
  let byteOffset = 0
  let bit: number | null = null

  if (letters === 'DB') {
    db = headNumber
    const body = (parts[1] ?? '').replace(/^DB/, '')
    const bodyMatch = body.match(/^([XBWDR]?)(\d+)$/)
    if (!bodyMatch) throw new Error(`无效 S7 地址 ${address}`)
    byteOffset = Number.parseInt(bodyMatch[2], 10)
    if (bodyMatch[1] === 'X') bit = Number.parseInt(parts[2] ?? '0', 10)
  } else {
    const areaKey = letters[0]
    const type = letters.slice(1)
    byteOffset = headNumber
    // M0.0 / I0.1 这种写法：点号后为位号
    if (parts[1] !== undefined) bit = Number.parseInt(parts[1], 10)
    else if (type === 'X') bit = 0
    if (type && type !== 'X' && type !== 'B' && type !== 'W' && type !== 'D') throw new Error(`无效 S7 地址 ${address}`)
    letters = areaKey
  }

  const area = AREA[letters]
  if (area === undefined) throw new Error(`不支持的 S7 存储区 ${letters}`)
  return { area, db, byteOffset, bit }
}

export class S7Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'S7Error'
  }
}

function isoConnectRequest(rack: number, slot: number) {
  const remoteTsap = (0x03 << 8) | (rack * 0x20 + slot)
  const frame = Buffer.from([
    0x03, 0x00, 0x00, 0x16,
    0x11, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x00,
    0xc0, 0x01, 0x0a, // TPDU size 1024
    0xc1, 0x02, 0x01, 0x00, // 本地 TSAP 0x0100
    0xc2, 0x02, (remoteTsap >> 8) & 0xff, remoteTsap & 0xff, // 远端 TSAP
  ])
  return frame
}

function wrapS7(param: Buffer, data: Buffer | null, pduRef: number) {
  const header = Buffer.alloc(10)
  header[0] = 0x32
  header[1] = 0x01 // Job
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(pduRef & 0xffff, 4)
  header.writeUInt16BE(param.length, 6)
  header.writeUInt16BE(data ? data.length : 0, 8)
  const s7 = data ? Buffer.concat([header, param, data]) : Buffer.concat([header, param])
  const payload = Buffer.concat([Buffer.from([0x02, 0xf0, 0x80]), s7])
  const tpkt = Buffer.alloc(4)
  tpkt[0] = 0x03
  tpkt.writeUInt16BE(payload.length + 4, 2)
  return Buffer.concat([tpkt, payload])
}

function buildAddressItem(area: number, db: number, byteOffset: number, bit: number | null, bytes: number) {
  const item = Buffer.alloc(12)
  item[0] = 0x12
  item[1] = 0x0a
  item[2] = 0x10 // S7ANY
  item[3] = 0x02 // transport size = BYTE
  item.writeUInt16BE(bytes, 4)
  item.writeUInt16BE(db, 6)
  item[8] = area
  const addr = (byteOffset << 3) | (bit ?? 0)
  item[9] = (addr >> 16) & 0xff
  item[10] = (addr >> 8) & 0xff
  item[11] = addr & 0xff
  return item
}

function buildReadRequest(target: S7Address, bytes: number, pduRef: number) {
  const param = Buffer.alloc(2)
  param[0] = 0x04 // Read
  param[1] = 0x01 // item count
  return wrapS7(Buffer.concat([param, buildAddressItem(target.area, target.db, target.byteOffset, target.bit, bytes)]), null, pduRef)
}

function buildWriteRequest(target: S7Address, bytes: number, values: Buffer, pduRef: number) {
  const param = Buffer.alloc(2)
  param[0] = 0x05 // Write
  param[1] = 0x01
  const data = Buffer.alloc(4 + values.length)
  data[0] = 0x00
  data[1] = 0x02 // transport size = BYTE
  data.writeUInt16BE(values.length, 2)
  values.copy(data, 4)
  return wrapS7(Buffer.concat([param, buildAddressItem(target.area, target.db, target.byteOffset, target.bit, bytes)]), data, pduRef)
}

function buildSetupRequest(pduRef: number) {
  const param = Buffer.from([0xf0, 0x00, 0x00, 0x01, 0x00, 0x01, 0x03, 0xc0])
  return wrapS7(param, null, pduRef)
}

function unwrapS7(frame: Buffer) {
  const s7 = frame.subarray(7) // 去掉 TPKT(4) + COTP DT(3)
  if (s7[0] !== 0x32) throw new S7Error('非 S7 报文')
  const rosctr = s7[1]
  const paramLen = s7.readUInt16BE(6)
  const dataLen = s7.readUInt16BE(8)
  if (rosctr === 0x02) throw new S7Error('S7 返回拒绝报文')
  if (rosctr !== 0x03) throw new S7Error(`未知 S7 响应类型 0x${rosctr.toString(16)}`)
  if (dataLen === 0) {
    const errorClass = s7[10 + Math.max(0, paramLen - 2)] ?? 0
    const errorCode = s7[11 + Math.max(0, paramLen - 2)] ?? 0
    throw new S7Error(`S7 错误 0x${((errorClass << 8) | errorCode).toString(16)}`)
  }
  const dataStart = 10 + paramLen
  if (s7[dataStart] !== 0xff) throw new S7Error(`S7 返回值异常 0x${s7[dataStart].toString(16)}`)
  return s7.subarray(dataStart + 4, dataStart + dataLen)
}

export class S7Driver extends BaseDriver {
  private transport: TcpTransport
  private pduRef = 1

  constructor(device: Device) {
    super(device)
    this.transport = new TcpTransport(device.host ?? '', device.port || 102, Math.max(500, device.timeout || 3000))
  }

  get connected() {
    return this.transport.connected
  }

  async connect() {
    await this.transport.connect()
    // COTP 连接建立（TPKT 层），随后进行 S7 通讯建立
    const rack = this.device.rack ?? 0
    const slot = this.device.slot ?? (this.device.protocol === 's7-300' ? 2 : this.device.protocol === 's7-400' ? 3 : 1)
    try {
      await this.transport.request(isoConnectRequest(rack, slot), tpktMatcher)
    } catch (error) {
      throw new Error(`S7 ISO 连接失败: ${(error as Error).message}`)
    }
    try {
      await this.transport.request(buildSetupRequest(this.nextRef()), tpktMatcher)
    } catch {
      // 部分 PLC 不支持通讯建立，忽略
    }
  }

  private nextRef() {
    this.pduRef = (this.pduRef + 1) & 0xffff
    return this.pduRef
  }

  async probe() {
    await this.connect()
    try {
      await this.readBytes({ area: AREA.M, db: 0, byteOffset: 0, bit: null }, 1)
    } catch (error) {
      // S7 级别错误说明链路与协议栈已通（类似 Modbus 异常码）
      if (error instanceof S7Error) return
      throw error
    }
  }

  private async readBytes(target: S7Address, bytes: number) {
    const frame = await this.transport.request(buildReadRequest(target, bytes, this.nextRef()), tpktMatcher)
    const payload = unwrapS7(frame)
    if (payload.length < bytes) throw new S7Error(`S7 返回数据不足 (${payload.length}/${bytes})`)
    return payload.subarray(0, bytes)
  }

  private async writeBytes(target: S7Address, bytes: number, values: Buffer) {
    const frame = await this.transport.request(buildWriteRequest(target, bytes, values, this.nextRef()), tpktMatcher)
    unwrapS7(frame)
  }

  async readTag(tag: Tag) {
    const target = parseS7Address(tag.address)
    if (tag.dataType === 'bool') {
      const buf = await this.readBytes({ ...target, bit: null }, 1)
      const bit = target.bit ?? 0
      return ((buf[0] >> bit) & 0x01) === 1
    }
    const bytes = registerCount(tag.dataType) * 2
    const buf = await this.readBytes({ ...target, bit: null }, bytes)
    const decoded = decodeBytes(buf, tag.dataType, tag.byteOrder)
    if (typeof decoded === 'number') return applyScale(decoded, tag.scale, tag.offset)
    return decoded
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    const target = parseS7Address(tag.address)
    if (tag.dataType === 'bool') {
      const buf = await this.readBytes({ ...target, bit: null }, 1)
      const bit = target.bit ?? 0
      const next = toBoolean(value) ? buf[0] | (1 << bit) : buf[0] & ~(1 << bit)
      await this.writeBytes({ ...target, bit: null }, 1, Buffer.from([next & 0xff]))
      return
    }
    const bytes = registerCount(tag.dataType) * 2
    const buf = encodeBytes(value, tag.dataType, tag.byteOrder, tag.scale, tag.offset)
    await this.writeBytes({ ...target, bit: null }, bytes, buf.subarray(0, bytes))
  }

  async close() {
    await this.transport.close()
  }
}
