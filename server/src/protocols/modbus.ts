import { createRequire } from 'node:module'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import {
  applyScale,
  encodeBytes,
  decodeBytes,
  registerCount,
  toBoolean,
  withTimeout,
} from './util.ts'

const require = createRequire(import.meta.url)
const ModbusRTU = require('modbus-serial') as new () => ModbusClient

interface ModbusClient {
  connectTCP: (host: string, options: { port: number }) => Promise<void>
  connectRTUBuffered: (port: string, options: { baudRate: number }) => Promise<void>
  connectAsciiSerial: (port: string, options: { baudRate: number }) => Promise<void>
  setID: (id: number) => void
  setTimeout: (ms: number) => void
  close: (cb?: () => void) => void
  destroy: (cb?: () => void) => void
  isOpen?: boolean
  readCoils: (addr: number, len: number) => Promise<{ data: boolean[] }>
  readDiscreteInputs: (addr: number, len: number) => Promise<{ data: boolean[] }>
  readHoldingRegisters: (addr: number, len: number) => Promise<{ data: number[] }>
  readInputRegisters: (addr: number, len: number) => Promise<{ data: number[] }>
  writeCoil: (addr: number, value: boolean) => Promise<unknown>
  writeRegisters: (addr: number, values: number[]) => Promise<unknown>
}

function parseModbusAddress(address: string, functionCode = '03') {
  const raw = Number.parseInt(address.split(':')[0] ?? '', 10)
  if (Number.isNaN(raw)) throw new Error(`无效地址 ${address}`)
  const fc = functionCode.padStart(2, '0')
  if (fc === '01' && raw >= 1 && raw < 10000) return raw - 1
  if (fc === '02' && raw >= 10001 && raw < 20000) return raw - 10001
  if (fc === '02' && raw >= 1 && raw < 10000) return raw - 1
  if (fc === '04' && raw >= 30001 && raw < 40000) return raw - 30001
  if (fc === '03' && raw >= 40001 && raw < 50000) return raw - 40001
  if ((fc === '03' || fc === '04') && raw >= 1 && raw <= 9999) return raw - 1
  return raw
}

function safeClose(client: ModbusClient) {
  // 先 destroy 立即中断仍在握手的 socket（避免等待系统级 ETIMEDOUT），再 close 释放资源
  // 必须传回调：不传时 modbus-serial 会返回 Promise，其 rejection 无人处理会导致进程崩溃
  try { client.destroy(() => undefined) } catch { /* ignore */ }
  try { client.close(() => undefined) } catch { /* ignore */ }
}

export class ModbusDriver extends BaseDriver {
  private client: ModbusClient | null = null
  private connecting: Promise<void> | null = null

  get connected() {
    return Boolean(this.client?.isOpen)
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async open() {
    const client = new ModbusRTU()
    client.setTimeout(this.timeoutMs)
    try {
      if (this.device.protocol === 'modbus-rtu') {
        if (!this.device.serialPort) throw new Error('未配置串口')
        await withTimeout(
          client.connectRTUBuffered(this.device.serialPort, { baudRate: this.device.baudRate || 9600 }),
          this.timeoutMs,
          '串口连接',
        )
      } else if (this.device.protocol === 'modbus-ascii') {
        if (!this.device.serialPort) throw new Error('未配置串口')
        await withTimeout(
          client.connectAsciiSerial(this.device.serialPort, { baudRate: this.device.baudRate || 9600 }),
          this.timeoutMs,
          '串口连接',
        )
      } else {
        if (!this.device.host) throw new Error('未配置 IP 地址')
        await withTimeout(
          client.connectTCP(this.device.host, { port: this.device.port || 502 }),
          this.timeoutMs,
          `连接 ${this.device.host}:${this.device.port || 502}`,
        )
      }
    } catch (error) {
      safeClose(client)
      throw error
    }
    client.setID(this.device.slaveId || 1)
    this.client = client
  }

  async probe() {
    await withTimeout(this.connect(), this.timeoutMs, '连接设备')
    if (!this.client?.isOpen) throw new Error('TCP 未建立')
    try {
      await withTimeout(this.client.readHoldingRegisters(0, 1), this.timeoutMs, '读取保持寄存器')
      return
    } catch (error) {
      if (isModbusException(error)) return
      try {
        await withTimeout(this.client.readCoils(0, 1), this.timeoutMs, '读取线圈')
        return
      } catch (next) {
        if (isModbusException(next)) return
        throw next
      }
    }
  }

  async close() {
    const client = this.client
    this.client = null
    this.connecting = null
    if (!client) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      const guard = setTimeout(finish, 2000)
      guard.unref()
      try { client.destroy(() => finish()) } catch { /* ignore */ }
      try { client.close(() => finish()) } catch { finish() }
    })
  }

  async readTag(tag: Tag) {
    await this.connect()
    if (!this.client) throw new Error('未连接')
    const fc = (tag.functionCode ?? '03').padStart(2, '0')
    const addr = parseModbusAddress(tag.address, fc)
    const len = registerCount(tag.dataType)

    if (fc === '01' || fc === '02') {
      const result = fc === '01'
        ? await this.client.readCoils(addr, 1)
        : await this.client.readDiscreteInputs(addr, 1)
      return Boolean(result.data[0])
    }

    const result = fc === '04'
      ? await this.client.readInputRegisters(addr, len)
      : await this.client.readHoldingRegisters(addr, len)

    const buf = Buffer.alloc(result.data.length * 2)
    result.data.forEach((value, index) => buf.writeUInt16BE(value & 0xffff, index * 2))
    const decoded = decodeBytes(buf, tag.dataType, tag.byteOrder)
    if (typeof decoded === 'number') return applyScale(decoded, tag.scale, tag.offset)
    return decoded
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    if (!this.client) throw new Error('未连接')
    const fc = (tag.functionCode ?? '03').padStart(2, '0')
    const addr = parseModbusAddress(tag.address, fc)
    if (fc === '02' || fc === '04') throw new Error('该功能码不支持写入')
    if (fc === '01' || tag.dataType === 'bool') {
      await this.client.writeCoil(addr, toBoolean(value))
      return
    }
    const buf = encodeBytes(value, tag.dataType, tag.byteOrder, tag.scale, tag.offset)
    const registers: number[] = []
    for (let i = 0; i < buf.length; i += 2) {
      registers.push(buf.readUInt16BE(i))
    }
    await this.client.writeRegisters(addr, registers)
  }
}

function isModbusException(error: unknown) {
  const err = error as { modbusCode?: number; message?: string }
  if (typeof err.modbusCode === 'number' && err.modbusCode >= 1 && err.modbusCode <= 11) return true
  const msg = String(err.message || '')
  return /^Modbus exception\s+\d+/i.test(msg) || /Illegal data address|Illegal function|Illegal data value/i.test(msg)
}

export function isModbus(protocol: string) {
  return protocol === 'modbus-tcp' || protocol === 'modbus-rtu' || protocol === 'modbus-ascii'
}
