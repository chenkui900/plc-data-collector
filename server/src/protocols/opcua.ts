import type { ClientSession, OPCUAClient } from 'node-opcua'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { applyScale, toBoolean } from './util.ts'

type OpcUaModule = typeof import('node-opcua')

// OPC UA 客户端：连接 → 建立会话 → 按 NodeId 读写 Value 属性
export class OpcUaDriver extends BaseDriver {
  private client: OPCUAClient | null = null
  private session: ClientSession | null = null
  private connecting: Promise<void> | null = null
  private module: OpcUaModule | null = null

  get connected() {
    return Boolean(this.session)
  }

  private get endpointUrl() {
    if (!this.device.host) throw new Error('未配置 OPC UA 服务器地址')
    const host = this.device.host.startsWith('opc.tcp://') ? this.device.host : `opc.tcp://${this.device.host}`
    const port = this.device.port || 4840
    return host.includes(':', host.indexOf('//') + 2) ? host : `${host}:${port}`
  }

  async connect() {
    if (this.session) return
    if (this.connecting) return this.connecting
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async open() {
    let opcua: OpcUaModule
    try {
      opcua = await import('node-opcua')
    } catch {
      throw new Error('未安装 node-opcua，请执行 npm install node-opcua 后重试')
    }
    this.module = opcua
    const client = opcua.OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0, initialDelay: 500, maxDelay: 2000 },
      requestedSessionTimeout: Math.max(5000, this.timeoutMs),
    })
    await client.connect(this.endpointUrl)
    const session = await client.createSession()
    this.client = client
    this.session = session
  }

  private variant(tag: Tag, value: string | number | boolean, opcua: OpcUaModule) {
    const numeric = typeof value === 'number' ? value : Number(value)
    switch (tag.dataType) {
      case 'bool':
        return { dataType: opcua.DataType.Boolean, value: toBoolean(value) }
      case 'int16':
        return { dataType: opcua.DataType.Int16, value: Math.trunc(numeric) }
      case 'uint16':
      case 'word':
        return { dataType: opcua.DataType.UInt16, value: Math.trunc(numeric) }
      case 'int32':
        return { dataType: opcua.DataType.Int32, value: Math.trunc(numeric) }
      case 'uint32':
      case 'dword':
        return { dataType: opcua.DataType.UInt32, value: Math.trunc(numeric) }
      case 'int64':
        return { dataType: opcua.DataType.Int64, value: BigInt(Math.trunc(numeric)) }
      case 'uint64':
        return { dataType: opcua.DataType.UInt64, value: BigInt(Math.trunc(numeric)) }
      case 'float32':
        return { dataType: opcua.DataType.Float, value: numeric }
      case 'float64':
        return { dataType: opcua.DataType.Double, value: numeric }
      case 'byte':
        return { dataType: opcua.DataType.Byte, value: Math.trunc(numeric) & 0xff }
      default:
        return { dataType: opcua.DataType.String, value: String(value) }
    }
  }

  async probe() {
    await this.connect()
  }

  async readTag(tag: Tag) {
    await this.connect()
    const session = this.session
    const opcua = this.module
    if (!session || !opcua) throw new Error('OPC UA 未连接')
    const dataValue = await session.read({
      nodeId: tag.address,
      attributeId: opcua.AttributeIds.Value,
    })
    const raw = dataValue.value.value
    if (typeof raw === 'bigint') return Number(raw)
    if (typeof raw === 'number') return applyScale(raw, tag.scale, tag.offset)
    if (typeof raw === 'boolean') return raw
    return raw === null || raw === undefined ? '' : String(raw)
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    const session = this.session
    const opcua = this.module
    if (!session || !opcua) throw new Error('OPC UA 未连接')
    await session.write({
      nodeId: tag.address,
      attributeId: opcua.AttributeIds.Value,
      value: { value: this.variant(tag, value, opcua) },
    })
  }

  async close() {
    const session = this.session
    const client = this.client
    this.session = null
    this.client = null
    this.connecting = null
    try {
      if (session) await session.close()
    } catch {
      /* ignore */
    }
    try {
      if (client) await client.disconnect()
    } catch {
      /* ignore */
    }
  }
}
