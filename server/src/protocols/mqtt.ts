import type { MqttClient } from 'mqtt'
import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'
import { applyScale, toBoolean, withTimeout } from './util.ts'

// MQTT 作为设备数据源：订阅主题采集，写入即发布
// 地址格式：topic 或 topic#json.path（# 后为 JSON 取值路径）
interface Pending {
  resolve: (value: string) => void
  reject: (error: Error) => void
}

function splitAddress(address: string) {
  const [topic, path] = address.split('#')
  return { topic: topic.trim(), path: path?.trim() }
}

function digJson(text: string, path?: string) {
  if (!path) return text
  try {
    const parsed = JSON.parse(text) as unknown
    const result = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key]
      }
      return undefined
    }, parsed)
    return result === undefined ? text : String(result)
  } catch {
    return text
  }
}

function convert(value: string, tag: Tag) {
  if (tag.dataType === 'bool') return toBoolean(value)
  if (tag.dataType === 'string') return value
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return value
  return applyScale(numeric, tag.scale, tag.offset)
}

export class MqttSourceDriver extends BaseDriver {
  private client: MqttClient | null = null
  private connecting: Promise<MqttClient> | null = null
  private cache = new Map<string, string>()
  private waiting = new Map<string, Pending[]>()

  get connected() {
    return Boolean(this.client?.connected)
  }

  async connect() {
    if (this.connected) return
    if (this.connecting) {
      await this.connecting
      return
    }
    if (!this.device.host) throw new Error('未配置 Broker 地址')
    this.connecting = (async () => {
      const mqtt = await import('mqtt')
      const url = `mqtt://${this.device.host}:${this.device.port || 1883}`
      const client = await mqtt.connectAsync(url, {
        clientId: `plc-aotu-${this.device.id}`,
        connectTimeout: this.timeoutMs,
        reconnectPeriod: 0,
      })
      client.on('message', (topic, payload) => {
        const text = payload.toString('utf8')
        this.cache.set(topic, text)
        const waiters = this.waiting.get(topic)
        if (waiters?.length) {
          this.waiting.delete(topic)
          for (const item of waiters) item.resolve(text)
        }
      })
      client.on('error', () => undefined)
      this.client = client
      return client
    })()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async subscribe(topic: string) {
    await this.connect()
    const client = this.client
    if (!client) throw new Error('MQTT 未连接')
    if (!this.cache.has(topic)) {
      await client.subscribeAsync(topic, { qos: 0 })
    }
  }

  private async waitForValue(topic: string) {
    const cached = this.cache.get(topic)
    if (cached !== undefined) return cached
    await this.subscribe(topic)
    return withTimeout(
      new Promise<string>((resolve, reject) => {
        const list = this.waiting.get(topic) ?? []
        list.push({ resolve, reject })
        this.waiting.set(topic, list)
      }),
      this.timeoutMs,
      `等待主题 ${topic}`,
    )
  }

  async probe() {
    await this.connect()
  }

  async readTag(tag: Tag) {
    const { topic, path } = splitAddress(tag.address)
    const raw = await this.waitForValue(topic)
    return convert(digJson(raw, path), tag)
  }

  async writeTag(tag: Tag, value: string | number | boolean) {
    await this.connect()
    const { topic } = splitAddress(tag.address)
    if (!this.client) throw new Error('MQTT 未连接')
    await this.client.publishAsync(topic, String(value), { qos: 0 })
  }

  async close() {
    const client = this.client
    this.client = null
    this.cache.clear()
    this.waiting.clear()
    if (!client) return
    try {
      await client.endAsync(true)
    } catch {
      /* ignore */
    }
  }
}
