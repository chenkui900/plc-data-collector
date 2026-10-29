import type { Device, Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { PLC } from 'ethernet-ip'
import { buildReadRequest } from 'ethernet-ip/dist/plc/read.js'
import * as MessageRouter from 'ethernet-ip/dist/cip/message-router.js'

function getNowText() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function applyScale(value: unknown, tag: Tag): unknown {
  const scale = typeof tag.scale === 'number' ? tag.scale : 1
  const offset = typeof tag.offset === 'number' ? tag.offset : 0
  if (typeof value === 'number') {
    if (scale === 1 && offset === 0) return value
    return value * scale + offset
  }
  return value
}

/**
 * 兼容 KepServer 风格地址：`Tag.DATA/22` → `Tag.DATA[22]`
 * （CIP 路径里 `/22` 不是合法的数组下标写法，会报 Path destination unknown；
 *   只有「标识符/纯数字下标」结尾的形式才转换，避免误伤其他写法）
 */
export function normalizeEnipAddress(address: string): string {
  return String(address || '').replace(
    /^([A-Za-z_][A-Za-z0-9_:]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\/(\d+)$/,
    '$1[$2]',
  )
}

export class EnipNodeDriver extends BaseDriver {
  private plc: PLC
  private _connected = false
  private failCount = 0

  constructor(device: Device) {
    super(device)
    this.plc = new PLC()
  }

  get connected() {
    return this._connected
  }

  async connect(): Promise<void> {
    if (this._connected) return
    const slot = this.device.slot ?? 0
    const deviceName = this.device.name || this.device.host || '未知设备'
    
    console.log(`[${getNowText()}] [${deviceName}] 正在连接 PLC (IP: ${this.device.host}, Slot: ${slot})...`)

    const emitter = (this.plc as any).emitter
    if (emitter && !emitter.__plcErrorBound) {
      emitter.__plcErrorBound = true
      emitter.on('error', (err: unknown) => {
        this._connected = false
      })
      emitter.on('close', () => {
        this._connected = false
      })
    }

    const timeoutMs = Math.max(3000, this.device.timeout || 3000)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('连接超时(Timeout)')), timeoutMs)
    )

    try {
      await Promise.race([
        this.plc.connect(this.device.host ?? '', { slot }),
        timeoutPromise
      ])
      this._connected = true
      this.failCount = 0
      console.log(`[${getNowText()}] [${deviceName}] PLC 连接成功`)
    } catch (e) {
      this._connected = false
      console.error(`[${getNowText()}] [${deviceName}] PLC 连接失败:`, (e as Error).message)
      throw e
    }
  }

  async probe(): Promise<void> {
    if (!this._connected) await this.connect()
  }

  async readTag(tag: Tag): Promise<unknown> {
    if (!this._connected) await this.connect()

    const deviceName = this.device.name || this.device.host || '未知设备'

    try {
      let raw: unknown
      if (String(tag.dataType ?? '').toLowerCase() === 'string') {
        // Logix STRING 的 LEN 字段可能不被 PLC 程序维护（实测 LEN=6 但 DATA 里有 8 个字符），
        // 因此 string 类型直接读 .DATA 数组，按 0 字节截断解码；失败时回退标准读法。
        raw = await this.readStringByData(tag.address).catch(() => undefined)
        if (raw === undefined) raw = await this.plc.read(normalizeEnipAddress(tag.address))
      } else {
        raw = await this.plc.read(normalizeEnipAddress(tag.address))
      }
      this.failCount = 0
      return applyScale(raw, tag)
    } catch (e) {
      this.failCount += 1
      console.error(`[${getNowText()}] [${deviceName}] [ENIP] 读取失败:`, tag.address, '→', (e as Error).message)

      if (this.failCount >= 1) {
        await this.close().catch(() => undefined)
        this.failCount = 0
      }
      throw e
    }
  }

  /**
   * 读取 Logix STRING 的完整 DATA 字符数组并解码（忽略 LEN 字段）。
   * 返回 undefined 表示读取失败，由调用方回退。
   */
  private async readStringByData(address: string): Promise<string | undefined> {
    const base = normalizeEnipAddress(address)
    if (/\.(DATA|LEN)$/i.test(base) || base.endsWith(']')) return undefined
    const resp = await this.plc.sendCIP(buildReadRequest(`${base}.DATA`, 82))
    const parsed = MessageRouter.parse(resp)
    if (parsed.generalStatusCode !== 0) return undefined
    // 响应格式：[类型参数 2 字节（SINT）][82 个字符值]
    const buf = parsed.data as Buffer
    if (!buf || buf.length < 3) return undefined
    let s = ''
    let started = false
    for (let i = 2; i < buf.length; i++) {
      const b = buf[i]
      if (!started) {
        // 实测个别点位（如 MES_WIND1_PLAN）字符串从 DATA[1] 开始写，DATA[0] 恒为 0，
        // 此时跳过前导 0 才能读到真实内容；真正空的字符串整段都是 0，跳过也不会读出错值。
        if (b === 0) continue
        started = true
      }
      if (b === 0) break
      if (b >= 32 && b < 127) s += String.fromCharCode(b)
    }
    return s
  }

  async writeTag(tag: Tag, value: string | number | boolean): Promise<void> {
    if (!this._connected) await this.connect()
    await this.plc.write(normalizeEnipAddress(tag.address), value)
  }

  async close(): Promise<void> {
    try {
      await this.plc.disconnect()
    } catch { /* ignore */ }
    this._connected = false
  }
}