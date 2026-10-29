import net from 'node:net'
import { addLog, getStore, nowText, saveStore, touchPush } from './store.ts'
import { broadcast } from './bus.ts'
import { lookupProductName, prunePlanCache } from './plandb.ts'
import type { PushChannel, Tag } from './types.ts'

const timers = new Map<string, NodeJS.Timeout>()
const lastError = new Map<string, number>()

function emitLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, channel: PushChannel) {
  const settings = getStore().settings
  const rank = { debug: 0, info: 1, warn: 2, error: 3 }
  if (rank[level] < rank[settings.logLevel]) return
  const log = addLog({ level, source: 'Push', message, deviceId: channel.id })
  broadcast({ type: 'log', data: log })
}

function throttle(key: string, ms = 20000) {
  const now = Date.now()
  const prev = lastError.get(key) ?? 0
  if (now - prev < ms) return false
  lastError.set(key, now)
  return true
}

function snapshot(channel: PushChannel): Tag[] {
  const tags = getStore().tags.filter((tag) => tag.enabled)
  if (channel.tagFilter === 'group' && channel.tagGroups?.length) {
    return tags.filter((tag) => tag.group && channel.tagGroups?.includes(tag.group))
  }
  return tags
}

/**
 * 取「卷曲X完成」对应的计划号：同一设备下「卷曲X规格」/「卷曲X计划」点位的当前值。
 * （这两个点位在 PLC 里绑定的是 MES_WIND1_PLAN / MES_WIND2_PLAN 计划号）
 */
function findWindingPlanNo(
  values: ReturnType<typeof payload>['values'],
  device: string,
  name: string,
): string | undefined {
  const m = /^(.*卷曲\d)完成$/.exec(name)
  if (!m) return undefined
  const tag =
    values.find((v) => v.device === device && v.name === `${m[1]}规格`) ??
    values.find((v) => v.device === device && v.name === `${m[1]}计划`)
  if (!tag) return undefined
  const s = String(tag.value ?? '').trim()
  return s || undefined
}

function payload(channel: PushChannel) {
  const tags = snapshot(channel)
  return {
    ts: nowText(),
    channel: channel.name,
    values: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      device: tag.deviceName,
      address: tag.address,
      value: tag.currentValue ?? null,
      unit: tag.unit ?? '',
      quality: tag.quality,
    })),
  }
}

function setStatus(channel: PushChannel, status: PushChannel['status']) {
  if (channel.status === status && status !== 'running') return
  channel.status = status
  if (status === 'running') touchPush(channel)
  else channel.updatedAt = nowText()
  saveStore()
  broadcast({ type: 'push', data: { ...channel } })
}

async function pushOnce(channel: PushChannel) {
  const body = payload(channel)
  const text = JSON.stringify(body)
  try {
    if (channel.type === 'http') {
      if (!channel.url) throw new Error('未配置请求地址')
      const headers: Record<string, string> = { 'Content-Type': channel.contentType || 'application/json' }
      if (channel.headers) Object.assign(headers, JSON.parse(channel.headers))
      const res = await fetch(channel.url, {
        method: channel.method || 'POST',
        headers,
        body: text,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } else if (channel.type === 'tcp') {
      if (!channel.host || !channel.tcpPort) throw new Error('未配置 TCP 目标')
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: channel.host!, port: channel.tcpPort! }, () => {
          socket.write(`${text}\n`, () => {
            socket.end()
            resolve()
          })
        })
        socket.setTimeout(3000)
        socket.on('timeout', () => {
          socket.destroy()
          reject(new Error('TCP 超时'))
        })
        socket.on('error', reject)
      })
    } else if (channel.type === 'mqtt') {
      const mqtt = await import('mqtt')
      const url = `mqtt://${channel.broker}:${channel.port || 1883}`
      await new Promise<void>((resolve, reject) => {
        const client = mqtt.connect(url, {
          clientId: channel.clientId || `plc-aotu-${channel.id}`,
          username: channel.username,
          password: channel.password,
          connectTimeout: 3000,
        })
        const done = (error?: Error) => {
          client.end(true)
          if (error) reject(error)
          else resolve()
        }
        client.on('connect', () => {
          client.publish(channel.topic || 'plc/data', text, { qos: channel.qos ?? 0 }, (error) => {
            done(error || undefined)
          })
        })
        client.on('error', (error) => done(error))
      })
    } else if (channel.type === 'mysql') {
      const mysql = await import('mysql2/promise')
      if (!channel.dbHost || !channel.database || !channel.table) throw new Error('未配置数据库')
      const conn = await mysql.createConnection({
        host: channel.dbHost,
        port: channel.dbPort || 3306,
        user: channel.dbUsername,
        password: channel.dbPassword,
        database: channel.database,
        connectTimeout: 3000,
      })
      try {
        if (channel.createTable !== false) {
          await conn.query(
            `CREATE TABLE IF NOT EXISTS \`${channel.table}\` (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              ts DATETIME,
              tag_id VARCHAR(64),
              tag_name VARCHAR(128),
              device_name VARCHAR(128),
              value VARCHAR(255),
              quality VARCHAR(32)
            )`
          )
        }
        const specByPlanNo = new Map<string, string | undefined>()
        for (const item of body.values) {
          const isOn = String(item.value ?? '') === '1' || item.value === true
          let spec: string | undefined
          if (isOn) {
            const planNo = findWindingPlanNo(body.values, item.device, item.name)
            if (planNo) {
              // 同一次推送内同一计划号只查一次（lookupProductName 内部还有 5 分钟缓存）
              if (!specByPlanNo.has(planNo)) specByPlanNo.set(planNo, await lookupProductName(planNo))
              spec = specByPlanNo.get(planNo)
            }
          }
          if (spec !== undefined) {
            // 卷曲完成 → 计划号对应 ProductName 写入「卷曲规格」列
            await conn.query(
              `INSERT INTO \`${channel.table}\` (ts, tag_id, tag_name, device_name, value, quality, \`卷曲规格\`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [body.ts, item.id, item.name, item.device, String(item.value ?? ''), item.quality, spec],
            )
          } else {
            await conn.query(
              `INSERT INTO \`${channel.table}\` (ts, tag_id, tag_name, device_name, value, quality) VALUES (?, ?, ?, ?, ?, ?)`,
              [body.ts, item.id, item.name, item.device, String(item.value ?? ''), item.quality],
            )
          }
        }
      } finally {
        await conn.end()
      }
    }
    touchPush(channel)
    setStatus(channel, 'running')
  } catch (error) {
    setStatus(channel, 'error')
    if (throttle(`push-${channel.id}`)) {
      emitLog('error', `通道 [${channel.name}] 推送失败: ${(error as Error).message}`, channel)
    }
  }
}

function schedule(channel: PushChannel) {
  stopOne(channel.id)
  if (!channel.enabled) {
    if (channel.status !== 'stopped') setStatus(channel, 'stopped')
    return
  }
  const interval = Math.max(300, channel.pushInterval || 1000)
  void pushOnce(channel)
  timers.set(channel.id, setInterval(() => {
    const current = getStore().pushChannels.find((item) => item.id === channel.id)
    if (current) void pushOnce(current)
  }, interval))
}

function stopOne(id: string) {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
}

export function syncPusher() {
  const channels = getStore().pushChannels
  const enabled = new Set(channels.filter((item) => item.enabled).map((item) => item.id))
  for (const id of [...timers.keys()]) {
    if (!enabled.has(id)) stopOne(id)
  }
  prunePlanCache()
  for (const channel of channels) schedule(channel)
}

export function stopPusher() {
  for (const id of [...timers.keys()]) stopOne(id)
}
