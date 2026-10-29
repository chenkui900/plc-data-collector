import dgram from 'node:dgram'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { toBoolean, withTimeout } from './util.ts'

// CoAP over UDP：CON 请求，Uri-Path 选项，PUT 写入
const VERSION = 0x40 // version 1, type CON
const CODE_GET = 0x01
const CODE_PUT = 0x03
const OPTION_URI_PATH = 11
const PAYLOAD_MARKER = 0xff

function encodeOption(delta: number, value: Buffer) {
  const parts: number[] = []
  let header = 0
  if (delta < 13) header = delta << 4
  else if (delta < 269) {
    header = 13 << 4
    parts.push(delta - 13)
  } else {
    header = 14 << 4
    parts.push((delta - 269) >> 8, (delta - 269) & 0xff)
  }
  if (value.length < 13) header |= value.length
  else if (value.length < 269) {
    header |= 13
    parts.push(value.length - 13)
  } else {
    header |= 14
    parts.push((value.length - 269) >> 8, (value.length - 269) & 0xff)
  }
  return Buffer.concat([Buffer.from([header, ...parts]), value])
}

function buildCoapRequest(code: number, messageId: number, path: string, payload: Buffer | null) {
  const segments = path.split('/').filter(Boolean)
  const options: Buffer[] = []
  let previous = 0
  for (const segment of segments) {
    options.push(encodeOption(OPTION_URI_PATH - previous, Buffer.from(segment, 'utf8')))
    previous = OPTION_URI_PATH
  }
  const header = Buffer.alloc(4)
  header[0] = VERSION
  header[1] = code
  header.writeUInt16BE(messageId & 0xffff, 2)
  const body = Buffer.concat(options)
  if (payload && payload.length) {
    return Buffer.concat([header, body, Buffer.from([PAYLOAD_MARKER]), payload])
  }
  return Buffer.concat([header, body])
}

function extractPayload(frame: Buffer) {
  if (frame.length < 4) return Buffer.alloc(0)
  const tokenLength = frame[0] & 0x0f
  let offset = 4 + tokenLength
  while (offset < frame.length) {
    const byte = frame[offset]
    if (byte === PAYLOAD_MARKER) return frame.subarray(offset + 1)
    const lengthNibble = byte & 0x0f
    let length = lengthNibble
    offset += 1
    if (lengthNibble === 13) {
      length = frame[offset] + 13
      offset += 1
    } else if (lengthNibble === 14) {
      length = frame.readUInt16BE(offset) + 269
      offset += 2
    }
    offset += length
  }
  return Buffer.alloc(0)
}

export class CoapDriver extends BaseDriver {
  private socket: dgram.Socket | null = null
  private messageId = 1

  get connected() {
    return Boolean(this.socket)
  }

  async connect() {
    if (this.socket) return
    if (!this.device.host) throw new Error('未配置服务器地址')
    const socket = dgram.createSocket('udp4')
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, () => resolve())
    })
    socket.on('error', () => undefined)
  }

  private async exchange(code: number, path: string, payload: Buffer | null) {
    await this.connect()
    const socket = this.socket!
    const id = this.messageId & 0xffff
    this.messageId = (this.messageId + 1) & 0xffff
    const frame = buildCoapRequest(code, id, path, payload)
    const port = this.device.port || 5683
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        const onMessage = (msg: Buffer) => {
          if (msg.length < 4) return
          if (msg.readUInt16BE(2) !== id) return
          socket.off('message', onMessage)
          const responseCode = msg[1]
          const cls = responseCode >> 5
          if (cls >= 4) {
            reject(new Error(`CoAP 错误响应 ${cls}.${responseCode & 0x1f}`))
            return
          }
          resolve(extractPayload(msg))
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
      'CoAP 等待响应',
    )
  }

  async probe() {
    await this.exchange(CODE_GET, '', null)
  }

  async readTag(tag: Tag) {
    const payload = await this.exchange(CODE_GET, tag.address, null)
    const text = payload.toString('utf8').trim()
    if (tag.dataType === 'bool') return toBoolean(text)
    if (tag.dataType === 'string') return text
    const numeric = Number(text)
    return Number.isNaN(numeric) ? text : numeric
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.exchange(CODE_PUT, tag.address, Buffer.from(String(value), 'utf8'))
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
