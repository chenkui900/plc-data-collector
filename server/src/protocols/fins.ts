import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { TcpTransport, type FrameMatcher } from './tcp.ts'
import { applyScale, decodeBytes, encodeBytes, registerCount, toBoolean } from './util.ts'

// Omron FINS over TCP (FINS/TCP)
const AREA_BIT: Record<string, number> = { CIO: 0x30, W: 0x31, H: 0x32, A: 0x33, D: 0x02 }
const AREA_WORD: Record<string, number> = { CIO: 0xb0, W: 0xb1, H: 0xb2, A: 0xb3, D: 0x82 }

interface FinsAddress {
  area: string
  word: number
  bit: number
}

export function parseFinsAddress(address: string): FinsAddress {
  const raw = address.trim().toUpperCase().replace(/\s/g, '')
  const [main, bitPart] = raw.split('.')
  const match = main.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`无效 FINS 地址 ${address}`)
  const area = match[1]
  if (!(area in AREA_WORD)) throw new Error(`不支持的 FINS 区域 ${area}`)
  return { area, word: Number.parseInt(match[2], 10), bit: Number.parseInt(bitPart ?? '0', 10) }
}

const finsTcpMatcher: FrameMatcher = (buf) => {
  if (buf.length < 8) return null
  if (buf.readUInt32BE(0) !== 0x46494e53) return null // 'FINS'
  const length = buf.readUInt32BE(4)
  if (buf.length < 8 + length) return null
  return buf.subarray(0, 8 + length)
}

export class FinsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinsError'
  }
}

function buildFinsTcpFrame(command: number, body: Buffer) {
  const frame = Buffer.alloc(16 + body.length)
  frame.writeUInt32BE(0x46494e53, 0) // 'FINS'
  frame.writeUInt32BE(8 + body.length, 4) // command(4) + error(4) + body
  frame.writeUInt32BE(command, 8)
  frame.writeUInt32BE(0, 12) // error code
  body.copy(frame, 16)
  return frame
}

export class FinsDriver extends BaseDriver {
  private transport: TcpTransport
  private clientNode = 0
  private serverNode = 0

  constructor(device: Device) {
    super(device)
    this.transport = new TcpTransport(device.host ?? '', device.port || 9600, Math.max(500, device.timeout || 3000))
  }

  get connected() {
    return this.transport.connected
  }

  async connect() {
    await this.transport.connect()
    // 节点地址数据发送：客户端 → 服务器，服务器返回双方节点号
    const body = Buffer.alloc(4)
    body.writeUInt32BE(0, 0)
    const res = await this.transport.request(buildFinsTcpFrame(0x00000000, body), finsTcpMatcher)
    if (res.readUInt32BE(8) !== 0x00000001) throw new Error('FINS 节点地址握手失败')
    this.clientNode = res.readUInt32BE(16)
    this.serverNode = res.readUInt32BE(20)
  }

  private buildFinsFrame(command: number, data: Buffer) {
    const header = Buffer.alloc(10)
    header[0] = 0x80 // ICF：需要响应
    header[1] = 0x00 // RSV
    header[2] = 0x02 // GCT
    header[3] = 0x00 // DNA
    header[4] = this.serverNode & 0xff // DA1
    header[5] = 0x00 // DA2：CPU 单元
    header[6] = 0x00 // SNA
    header[7] = this.clientNode & 0xff // SA1
    header[8] = 0x00 // SA2
    header[9] = 0x00 // SID
    const commandBuf = Buffer.alloc(2)
    commandBuf.writeUInt16BE(command, 0)
    return Buffer.concat([header, commandBuf, data])
  }

  private async finsCommand(command: number, data: Buffer) {
    const frame = buildFinsTcpFrame(0x00000002, this.buildFinsFrame(command, data))
    const res = await this.transport.request(frame, finsTcpMatcher)
    const resCommand = res.readUInt32BE(8)
    if (resCommand !== 0x00000003) throw new Error('FINS 响应异常')
    const fins = res.subarray(16)
    const endCode = fins.readUInt16BE(10)
    if (endCode !== 0x0000) throw new FinsError(`FINS 结束码 0x${endCode.toString(16)}`)
    return fins.subarray(12)
  }

  private addressData(target: FinsAddress, count: number, isBit: boolean) {
    const data = Buffer.alloc(6)
    data[0] = isBit ? AREA_BIT[target.area] : AREA_WORD[target.area]
    data.writeUInt16BE(target.word, 1)
    data[3] = isBit ? target.bit : 0
    data.writeUInt16BE(count, 4)
    return data
  }

  async probe() {
    await this.connect()
    try {
      await this.finsCommand(0x0101, this.addressData({ area: 'D', word: 0, bit: 0 }, 1, false))
    } catch (error) {
      if (error instanceof FinsError) return
      throw error
    }
  }

  async readTag(tag: Tag) {
    const target = parseFinsAddress(tag.address)
    if (tag.dataType === 'bool') {
      const data = await this.finsCommand(0x0101, this.addressData(target, 1, true))
      return (data[0] & 0x01) === 1
    }
    const words = registerCount(tag.dataType)
    const data = await this.finsCommand(0x0101, this.addressData(target, words, false))
    const buf = Buffer.alloc(words * 2)
    for (let i = 0; i < words; i += 1) {
      buf.writeUInt16BE(data.readUInt16BE(i * 2), i * 2)
    }
    const decoded = decodeBytes(buf, tag.dataType, tag.byteOrder)
    if (typeof decoded === 'number') return applyScale(decoded, tag.scale, tag.offset)
    return decoded
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    const target = parseFinsAddress(tag.address)
    if (tag.dataType === 'bool') {
      const payload = Buffer.concat([this.addressData(target, 1, true), Buffer.from([toBoolean(value) ? 0x01 : 0x00])])
      await this.finsCommand(0x0102, payload)
      return
    }
    const words = registerCount(tag.dataType)
    const buf = encodeBytes(value, tag.dataType, tag.byteOrder, tag.scale, tag.offset)
    const values = Buffer.alloc(words * 2)
    buf.copy(values, 0, 0, Math.min(buf.length, words * 2))
    await this.finsCommand(0x0102, Buffer.concat([this.addressData(target, words, false), values]))
  }

  async close() {
    await this.transport.close()
  }
}
