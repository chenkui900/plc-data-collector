import net from 'node:net'
import { withTimeout } from './util.ts'

/** 判断缓冲区是否已构成一个完整响应帧，是则返回该帧，否则返回 null 继续等待 */
export type FrameMatcher = (buf: Buffer) => Buffer | null

/** 通用 TCP 传输，供各协议驱动复用（连接、请求-响应、超时、关闭） */
export class TcpTransport {
  private socket: net.Socket | null = null
  private connecting: Promise<void> | null = null
  private buffer = Buffer.alloc(0)

  constructor(
    private host: string,
    private port: number,
    private timeoutMs: number,
  ) {}

  get connected() {
    return Boolean(this.socket && !this.socket.destroyed && this.socket.readyState === 'open')
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) return this.connecting
    if (!this.host) throw new Error('未配置 IP 地址')
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async open() {
    const socket = net.createConnection({ host: this.host, port: this.port })
    socket.setTimeout(this.timeoutMs)
    socket.setNoDelay(true)
    this.socket = socket
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
        const onTimeout = () => {
          cleanup()
          reject(new Error('TCP 连接超时'))
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
      `连接 ${this.host}:${this.port}`,
    )
    // 连接成功后统一由 request/close 处理错误，避免游离 error 事件
    socket.on('error', () => undefined)
  }

  /** 发送请求并等待一帧完整响应 */
  async request(data: Buffer, matcher: FrameMatcher, timeoutMs = this.timeoutMs): Promise<Buffer> {
    await this.connect()
    const socket = this.socket!
    this.buffer = Buffer.alloc(0)
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        let done = false
        const finish = (err: Error | null, payload?: Buffer) => {
          if (done) return
          done = true
          socket.off('data', onData)
          socket.off('close', onClose)
          socket.off('timeout', onTimeout)
          if (err) reject(err)
          else resolve(payload!)
        }
        const onData = (chunk: Buffer) => {
          this.buffer = Buffer.concat([this.buffer, chunk])
          const frame = matcher(this.buffer)
          if (frame) finish(null, frame)
        }
        const onClose = (hadError: boolean) => finish(new Error(hadError ? '连接异常关闭' : '连接已关闭'))
        const onTimeout = () => finish(new Error('响应超时'))
        socket.on('data', onData)
        socket.once('close', onClose)
        socket.once('timeout', onTimeout)
        socket.write(data, (err) => {
          if (err) finish(err)
        })
      }),
      timeoutMs,
      '等待响应',
    )
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

/** TPKT(RFC1006) 帧匹配：03 00 + 长度 */
export function tpktMatcher(buf: Buffer) {
  if (buf.length < 4) return null
  if (buf[0] !== 0x03) return null
  const length = buf.readUInt16BE(2)
  if (buf.length < length) return null
  return buf.subarray(0, length)
}
