import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { TcpTransport } from './tcp.ts'
import { toBoolean } from './util.ts'

// DNP3 主站（over TCP）：链路层 + 传输层 + 应用层，读取 class 0 数据并缓存，支持直接操作命令
const LINK_START = [0x05, 0x64]
const FC_READ = 0x01
const FC_DIRECT_OPERATE = 0x05

const CRC_TABLE = (() => {
  const table = new Uint16Array(256)
  for (let i = 0; i < 256; i += 1) {
    let crc = 0
    let c = i
    for (let j = 0; j < 8; j += 1) {
      if (((crc ^ c) & 0x01) === 1) crc = (crc >>> 1) ^ 0xa6bc
      else crc >>>= 1
      c >>>= 1
    }
    table[i] = crc
  }
  return table
})()

function crc16(buf: Buffer) {
  let crc = 0
  for (const byte of buf) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  }
  return (~crc) & 0xffff
}

function buildLinkFrame(dest: number, src: number, control: number, userData: Buffer) {
  const blocks: Buffer[] = []
  let offset = 0
  while (offset < userData.length) {
    const chunk = userData.subarray(offset, offset + 16)
    const block = Buffer.alloc(chunk.length + 2)
    chunk.copy(block)
    block.writeUInt16LE(crc16(chunk), chunk.length)
    blocks.push(block)
    offset += 16
  }
  const data = Buffer.concat(blocks)
  const header = Buffer.alloc(10)
  header[0] = LINK_START[0]
  header[1] = LINK_START[1]
  header[2] = 5 + data.length
  header[3] = control
  header.writeUInt16LE(dest, 4)
  header.writeUInt16LE(src, 6)
  header.writeUInt16LE(crc16(header.subarray(0, 8)), 8)
  return Buffer.concat([header, data])
}

function extractUserData(linkFrame: Buffer) {
  const length = linkFrame[2]
  const totalData = length - 5
  let remaining = totalData
  let offset = 10
  const chunks: Buffer[] = []
  while (remaining > 2 && offset < linkFrame.length) {
    const blockDataLength = Math.min(16, remaining - 2)
    chunks.push(linkFrame.subarray(offset, offset + blockDataLength))
    offset += blockDataLength + 2
    remaining -= blockDataLength + 2
  }
  return Buffer.concat(chunks)
}

const dnp3Matcher = (buf: Buffer) => {
  if (buf.length < 10) return null
  if (buf[0] !== 0x05 || buf[1] !== 0x64) return null
  const length = buf[2]
  const total = 10 + (length - 5)
  if (buf.length < total) return null
  return buf.subarray(0, total)
}

export class Dnp3Driver extends BaseDriver {
  private transport: TcpTransport
  private cache = new Map<number, number | boolean>()
  private sequence = 0

  constructor(device: Device) {
    super(device)
    this.transport = new TcpTransport(device.host ?? '', device.port || 20000, Math.max(500, device.timeout || 3000))
  }

  get connected() {
    return this.transport.connected
  }

  get destination() {
    return this.device.slaveId || 1
  }

  async connect() {
    await this.transport.connect()
  }

  private nextSequence() {
    this.sequence = (this.sequence + 1) & 0x0f
    return this.sequence
  }

  private buildAppData(functionCode: number, objects: Buffer, isResponse = false) {
    const ac = 0xc0 | this.nextSequence() // FIR + FIN + 序号
    const head = isResponse
      ? Buffer.from([ac, functionCode, 0x00, 0x00])
      : Buffer.from([ac, functionCode])
    return Buffer.concat([Buffer.from([0xc0]), head, objects]) // 传输层首字节 FIR|FIN
  }

  private async request(functionCode: number, objects: Buffer) {
    const appData = this.buildAppData(functionCode, objects)
    const frame = buildLinkFrame(this.destination, 0, 0xc4, appData)
    const response = await this.transport.request(frame, dnp3Matcher)
    return extractUserData(response)
  }

  private async readClass0() {
    const objects = Buffer.from([60, 1, 0x06]) // 60/1 class 0 全部点
    const userData = await this.request(FC_READ, objects)
    if (userData.length < 4) throw new Error('DNP3 响应过短')
    const functionCode = userData[2]
    if (functionCode !== 0x81) throw new Error(`DNP3 响应功能码异常 0x${functionCode.toString(16)}`)
    this.parseObjects(userData.subarray(5))
  }

  private parseObjects(buf: Buffer) {
    let offset = 0
    while (offset + 3 <= buf.length) {
      const group = buf[offset]
      const variation = buf[offset + 1]
      const qualifier = buf[offset + 2]
      offset += 3
      let start = 0
      let count = 0
      if (qualifier === 0x00) {
        start = buf[offset]
        count = buf[offset + 1] - start + 1
        offset += 2
      } else if (qualifier === 0x01) {
        start = buf.readUInt16LE(offset)
        count = buf.readUInt16LE(offset + 2) - start + 1
        offset += 4
      } else if (qualifier === 0x17) {
        count = buf[offset]
        start = 0
        offset += 1
      } else if (qualifier === 0x28) {
        count = buf.readUInt16LE(offset)
        start = 0
        offset += 2
      } else {
        break // 无法识别的限定词，停止解析
      }
      for (let i = 0; i < count; i += 1) {
        const index = start + i
        if (group === 1 && variation === 2) {
          // 二进制输入（带标志，1 字节/点）
          if (offset + 1 > buf.length) return
          this.cache.set(index, (buf[offset] & 0x80) !== 0)
          offset += 1
        } else if (group === 10 && variation === 1) {
          if (offset + 1 > buf.length) return
          this.cache.set(index, (buf[offset] & 0x80) !== 0)
          offset += 1
        } else if (group === 30 && variation === 1) {
          if (offset + 3 > buf.length) return
          this.cache.set(index, buf.readInt16LE(offset))
          offset += 3
        } else if (group === 30 && variation === 2) {
          if (offset + 5 > buf.length) return
          this.cache.set(index, buf.readInt32LE(offset))
          offset += 5
        } else if (group === 30 && variation === 5) {
          if (offset + 5 > buf.length) return
          this.cache.set(index, buf.readFloatLE(offset))
          offset += 5
        } else if (group === 40 && variation === 1) {
          if (offset + 5 > buf.length) return
          this.cache.set(index, buf.readInt32LE(offset))
          offset += 5
        } else {
          return
        }
      }
    }
  }

  async probe() {
    await this.connect()
    await this.readClass0()
  }

  private parseIndex(address: string) {
    const parts = address.trim().split(':')
    const index = Number.parseInt(parts[parts.length - 1], 10)
    if (Number.isNaN(index)) throw new Error(`无效 DNP3 地址 ${address}`)
    return index
  }

  async readTag(tag: Tag) {
    await this.connect()
    await this.readClass0()
    const index = this.parseIndex(tag.address)
    const value = this.cache.get(index)
    if (value === undefined) throw new Error(`尚未收到索引 ${index} 的数据`)
    return value
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    const index = this.parseIndex(tag.address)
    const indexBuf = Buffer.alloc(2)
    indexBuf.writeUInt16LE(index, 0)
    if (tag.dataType === 'bool') {
      // g12 v1 CROB（控制继电器输出块）
      const crob = Buffer.alloc(11)
      crob[0] = 0x41 // 控制码：脉冲 ON + 清除
      crob[1] = 0x01 // 数量
      crob.writeUInt32LE(1000, 2) // on time
      crob.writeUInt32LE(1000, 6) // off time
      crob[10] = toBoolean(value) ? 0x01 : 0x02 // 状态：ON/OFF
      const objects = Buffer.concat([Buffer.from([12, 1, 0x01]), indexBuf, indexBuf, crob])
      await this.request(FC_DIRECT_OPERATE, objects)
      return
    }
    const numeric = typeof value === 'number' ? value : Number(value)
    const valueBuf = Buffer.alloc(5)
    valueBuf.writeInt32LE(Math.trunc(numeric), 0)
    valueBuf[4] = 0x01 // 状态：在线
    const objects = Buffer.concat([Buffer.from([41, 1, 0x01]), indexBuf, indexBuf, valueBuf])
    await this.request(FC_DIRECT_OPERATE, objects)
  }

  async close() {
    await this.transport.close()
  }
}
