import dgram from 'node:dgram'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { applyScale, toBoolean, withTimeout } from './util.ts'

// BACnet/IP：BVLL + NPDU + APDU，实现 ReadProperty / WriteProperty（presentValue）
const BVLL_TYPE = 0x81
const BVLL_UNICAST_NPDU = 0x0a
const SERVICE_READ_PROPERTY = 0x0c
const SERVICE_WRITE_PROPERTY = 0x0f
const PROP_PRESENT_VALUE = 85
const PROP_OBJECT_NAME = 77
const OBJ_DEVICE = 8

const OBJECT_TYPES: Record<string, number> = {
  'analog-input': 0, ai: 0,
  'analog-output': 1, ao: 1,
  'analog-value': 2, av: 2,
  'binary-input': 3, bi: 3,
  'binary-output': 4, bo: 4,
  'binary-value': 5, bv: 5,
  'multi-state-value': 19, msv: 19,
  device: 8, dev: 8,
}

interface BacnetAddress {
  objectType: number
  instance: number
}

export function parseBacnetAddress(address: string): BacnetAddress {
  const raw = address.trim().toLowerCase()
  const match = raw.match(/^([a-z-]+)[:. ]?(\d+)$/) ?? raw.match(/^([a-z]+)(\d+)$/)
  if (!match) throw new Error(`无效 BACnet 地址 ${address}`)
  const objectType = OBJECT_TYPES[match[1]]
  if (objectType === undefined) throw new Error(`不支持的 BACnet 对象类型 ${match[1]}`)
  return { objectType, instance: Number.parseInt(match[2], 10) }
}

export class BacnetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BacnetError'
  }
}

function encodeObjectIdentifier(address: BacnetAddress) {
  const value = ((address.objectType & 0x3ff) << 22) | (address.instance & 0x3fffff)
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

function buildBvll(apdu: Buffer) {
  const payload = Buffer.concat([Buffer.from([0x01, 0x04]), apdu]) // NPDU: version + control(期待应答)
  const header = Buffer.alloc(4)
  header[0] = BVLL_TYPE
  header[1] = BVLL_UNICAST_NPDU
  header.writeUInt16BE(payload.length + 4, 2)
  return Buffer.concat([header, payload])
}

function buildApdu(invokeId: number, service: number, body: Buffer) {
  return Buffer.concat([Buffer.from([0x00, 0x05, invokeId & 0xff, service]), body])
}

function contextTag(tagNumber: number, content: Buffer) {
  // 长度 < 5 直接写在标签字节低 3 位，否则使用扩展长度（低 3 位 = 5，后跟长度字节）
  if (content.length < 5) {
    return Buffer.concat([Buffer.from([(tagNumber << 4) | 0x08 | content.length]), content])
  }
  return Buffer.concat([Buffer.from([(tagNumber << 4) | 0x08 | 0x05, content.length & 0xff]), content])
}

function applicationValue(tag: Tag, value: string | number | boolean) {
  const numeric = typeof value === 'number' ? value : Number(value)
  switch (tag.dataType) {
    case 'bool':
      return Buffer.from([toBoolean(value) ? 0x11 : 0x10]) // 应用标签 boolean
    case 'int16':
    case 'uint16':
    case 'word':
    case 'byte': {
      const buf = Buffer.alloc(2)
      buf.writeUInt16BE(Math.trunc(numeric) & 0xffff, 0)
      return Buffer.concat([Buffer.from([0x22]), buf])
    }
    case 'int32':
    case 'uint32':
    case 'dword': {
      const buf = Buffer.alloc(4)
      buf.writeUInt32BE(Math.trunc(numeric) >>> 0, 0)
      return Buffer.concat([Buffer.from([0x24]), buf])
    }
    case 'float32': {
      const buf = Buffer.alloc(4)
      buf.writeFloatBE(numeric, 0)
      return Buffer.concat([Buffer.from([0x44]), buf])
    }
    case 'float64': {
      const buf = Buffer.alloc(8)
      buf.writeDoubleBE(numeric, 0)
      return Buffer.concat([Buffer.from([0x54]), buf])
    }
    case 'string': {
      const text = Buffer.from(String(value), 'utf8')
      const buf = Buffer.alloc(1 + text.length)
      buf.writeUInt8(0, 0) // ANSI X3.4
      text.copy(buf, 1)
      return Buffer.concat([Buffer.from([0x75]), buf])
    }
    default: {
      const buf = Buffer.alloc(4)
      buf.writeUInt32BE(Math.trunc(numeric) >>> 0, 0)
      return Buffer.concat([Buffer.from([0x24]), buf])
    }
  }
}

function readApplicationValue(buf: Buffer): string | number | boolean {
  if (buf.length === 0) throw new BacnetError('空的属性值')
  const tagByte = buf[0]
  const tagNumber = tagByte >> 4
  let length = tagByte & 0x07
  let offset = 1
  if (length === 5) {
    length = buf[1]
    offset = 2
  }
  const content = buf.subarray(offset, offset + length)
  switch (tagNumber) {
    case 1: // boolean
      return length === 1
    case 2: // unsigned
      return content.readUIntBE(0, Math.min(content.length, 6))
    case 3: // signed
      return content.readIntBE(0, Math.min(content.length, 6))
    case 4: // real
      return content.readFloatBE(0)
    case 5: // double
      return content.readDoubleBE(0)
    case 7: { // character string
      const text = content.subarray(1)
      return text.toString('utf8').replace(/\0+$/g, '')
    }
    case 9: // enumerated
      return content.readUIntBE(0, Math.min(content.length, 6))
    default:
      return content.readUIntBE(0, Math.min(content.length, 6))
  }
}

/** 解析 APDU 标签序列，返回 tagNumber -> 内容 */
function parseTags(buf: Buffer) {
  const items: { tagNumber: number; content: Buffer }[] = []
  let offset = 0
  while (offset < buf.length) {
    const tagByte = buf[offset]
    const tagNumber = tagByte >> 4
    const isContext = ((tagByte >> 3) & 0x01) === 1
    let length = tagByte & 0x07
    offset += 1
    if (length === 5) {
      // 扩展长度：后跟 1 字节长度
      length = buf[offset]
      offset += 1
    }
    items.push({ tagNumber: isContext ? tagNumber : tagNumber + 0x40, content: buf.subarray(offset, offset + length) })
    offset += length
  }
  return items
}

export class BacnetDriver extends BaseDriver {
  private socket: dgram.Socket | null = null
  private invokeId = 1

  get connected() {
    return Boolean(this.socket)
  }

  async connect() {
    if (this.socket) return
    if (!this.device.host) throw new Error('未配置 IP 地址')
    this.socket = dgram.createSocket('udp4')
    await new Promise<void>((resolve, reject) => {
      this.socket!.once('error', reject)
      this.socket!.bind(0, () => resolve())
    })
    this.socket.on('error', () => undefined)
  }

  private async exchange(apdu: Buffer, invokeId: number) {
    await this.connect()
    const socket = this.socket!
    const port = this.device.port || 47808
    const frame = buildBvll(apdu)
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        const onMessage = (msg: Buffer) => {
          if (msg.length < 6) return
          if (msg[0] !== BVLL_TYPE) return
          const apduStart = 4 + 2 // BVLL(4) + NPDU version/control(2)
          const response = msg.subarray(apduStart)
          if (response.length < 2) return
          if ((response[0] & 0xf0) !== 0x30) return // 仅处理 complex-ACK
          if (response[1] !== (invokeId & 0xff)) return
          socket.off('message', onMessage)
          resolve(response.subarray(2))
        }
        socket.on('message', onMessage)
        socket.send(frame, 0, frame.length, port, this.device.host!, (err) => {
          if (err) {
            socket.off('message', onMessage)
            reject(err)
          }
        })
      }),
      this.timeoutMs,
      'BACnet 等待响应',
    )
  }

  private nextInvokeId() {
    this.invokeId = (this.invokeId + 1) & 0xff
    return this.invokeId
  }

  private async readProperty(address: BacnetAddress, property: number) {
    const body = Buffer.concat([
      contextTag(0, encodeObjectIdentifier(address)),
      contextTag(1, Buffer.from([property & 0xff])),
    ])
    const response = await this.exchange(buildApdu(this.nextInvokeId(), SERVICE_READ_PROPERTY, body), this.invokeId)
    if (response[0] !== SERVICE_READ_PROPERTY) throw new BacnetError('BACnet 服务响应不匹配')
    const tags = parseTags(response.subarray(1))
    const value = tags.find((item) => item.tagNumber === 3)
    if (!value) throw new BacnetError('BACnet 响应缺少属性值')
    return readApplicationValue(value.content)
  }

  async probe() {
    await this.connect()
    try {
      await this.readProperty({ objectType: OBJ_DEVICE, instance: 1 }, PROP_OBJECT_NAME)
    } catch (error) {
      if (error instanceof BacnetError) return
      throw error
    }
  }

  async readTag(tag: Tag) {
    const address = parseBacnetAddress(tag.address)
    const value = await this.readProperty(address, PROP_PRESENT_VALUE)
    return typeof value === 'number' ? applyScale(value, tag.scale, tag.offset) : value
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    const address = parseBacnetAddress(tag.address)
    const body = Buffer.concat([
      contextTag(0, encodeObjectIdentifier(address)),
      contextTag(1, Buffer.from([PROP_PRESENT_VALUE & 0xff])),
      contextTag(3, applicationValue(tag, value)),
    ])
    await this.exchange(buildApdu(this.nextInvokeId(), SERVICE_WRITE_PROPERTY, body), this.invokeId)
  }

  async close() {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }
}
