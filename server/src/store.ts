import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import type { AppSettings, Device, PushChannel, Tag } from './types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../../data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const dbPath = resolve(dataDir, 'plc.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = DELETE')
db.exec('PRAGMA synchronous = FULL')

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    deviceId TEXT NOT NULL,
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tags_device ON tags(deviceId);

  CREATE TABLE IF NOT EXISTS push_channels (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    level TEXT,
    source TEXT,
    message TEXT,
    deviceId TEXT,
    tagId TEXT,
    time TEXT,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const LOG_LIMIT = 5000

export interface LogEntry {
  id: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  deviceId?: string
  tagId?: string
  time: string
}

const defaultSettings: AppSettings = {
  logLevel: 'info',
  globalPollInterval: 1000,
  maxConcurrent: 10,
  autoReconnect: true,
  reconnectInterval: 5000,
  enableCors: true,
  webPort: 8080,
} as AppSettings

interface Store {
  devices: Device[]
  tags: Tag[]
  pushChannels: PushChannel[]
  logs: LogEntry[]
  settings: AppSettings
}

const store: Store = {
  devices: [],
  tags: [],
  pushChannels: [],
  logs: [],
  settings: { ...defaultSettings },
}

export function getStore(): Store {
  return store
}

export function nextId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${ts}${rand}`
}

export function nowText(): string {
  return nowTextFromDate(new Date())
}

function nowTextFromDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function loadStore() {
  try {
    store.devices = db.prepare('SELECT data FROM devices').all().map((r: any) => JSON.parse(r.data) as Device)
    store.tags = db.prepare('SELECT data FROM tags').all().map((r: any) => JSON.parse(r.data) as Tag)
    store.pushChannels = db.prepare('SELECT data FROM push_channels').all().map((r: any) => JSON.parse(r.data) as PushChannel)
    store.logs = db
      .prepare('SELECT data FROM logs ORDER BY time DESC LIMIT ?')
      .all(LOG_LIMIT)
      .map((r: any) => JSON.parse(r.data) as LogEntry)
  } catch (e) {
    console.error('[Store] 从 SQLite 解析数据失败:', e)
  }

  const settingsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('app') as { value: string } | undefined
  if (settingsRow) {
    try {
      store.settings = { ...defaultSettings, ...JSON.parse(settingsRow.value) }
    } catch {
      store.settings = { ...defaultSettings }
    }
  } else {
    store.settings = { ...defaultSettings }
    saveSettings(store.settings)
  }

  refreshTagCounts()
  console.log(`[Store] 成功从数据库加载: ${store.devices.length} 个设备, ${store.tags.length} 个点位`)
}

export function saveStore(_force = false) {
  doSave()
}

function doSave() {
  // 防覆盖保护锁
  if (store.devices.length === 0 && store.tags.length === 0) {
    try {
      const dbCount = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as any).n
      if (dbCount > 0) {
        console.warn('[Store] ⚠️ 拦截到试图用空数据覆盖已有数据库的操作，已取消保存！')
        return
      }
    } catch (e) {}
  }

  const now = nowText()
  const safeStr = (v: any) => v === undefined ? null : String(v)

  // 1. 保存核心业务数据（设备、点位、推送）- 绝不让日志报错连累这里
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM devices').run()
    const insDev = db.prepare('INSERT INTO devices (id, data, updatedAt) VALUES (?, ?, ?)')
    for (const d of store.devices) insDev.run(safeStr(d.id), JSON.stringify(d), now)

    db.prepare('DELETE FROM tags').run()
    const insTag = db.prepare('INSERT INTO tags (id, deviceId, data, updatedAt) VALUES (?, ?, ?, ?)')
    for (const t of store.tags) insTag.run(safeStr(t.id), safeStr(t.deviceId), JSON.stringify(t), now)

    db.prepare('DELETE FROM push_channels').run()
    const insPush = db.prepare('INSERT INTO push_channels (id, data, updatedAt) VALUES (?, ?, ?)')
    for (const p of store.pushChannels) insPush.run(safeStr(p.id), JSON.stringify(p), now)

    db.exec('COMMIT')
 //   console.log(`[Store] 已持久化核心数据: ${store.devices.length} 设备, ${store.tags.length} 点位`)
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('[Store] 保存核心数据失败:', e)
  }

  // 2. 独立保存日志，即使报错也不影响设备
  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM logs').run()
    const insLog = db.prepare('INSERT INTO logs (id, level, source, message, deviceId, tagId, time, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const raw of store.logs.slice(0, LOG_LIMIT)) {
      const l = normalizeLog(raw)
      insLog.run(
        safeStr(l.id) || nextId('log'),
        safeStr(l.level) || 'info',
        safeStr(l.source) || 'System',
        safeStr(l.message) || '',
        safeStr(l.deviceId),
        safeStr(l.tagId),
        safeStr(l.time) || now,
        JSON.stringify(l)
      )
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('[Store] 保存日志失败(已忽略):', e)
  }
  
  try {
    saveSettings(store.settings)
  } catch (e) {
    console.error('[Store] 保存设置失败:', e)
  }
}

function saveSettings(settings: AppSettings) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('app', JSON.stringify(settings))
}

export function addLog(input: Omit<LogEntry, 'id' | 'time'>): LogEntry {
  const log: LogEntry = {
    id: nextId('log'),
    time: nowText(),
    ...input,
  }
  store.logs.unshift(log)
  if (store.logs.length > LOG_LIMIT) store.logs.length = LOG_LIMIT
  return log
}

export function touchDevice(device: Device, connected = false) {
  const now = nowText()
  device.updatedAt = now
  device.lastActiveAt = now
  if (connected) device.lastConnected = now
}

export function refreshTagCounts() {
  const counts = new Map<string, number>()
  for (const tag of store.tags) {
    counts.set(tag.deviceId, (counts.get(tag.deviceId) ?? 0) + 1)
  }
  for (const device of store.devices) {
    device.tagCount = counts.get(device.id) ?? 0
  }
}

export function pruneColdData(): boolean {
  const retentionDays = (store.settings as any).logRetentionDays ?? 7
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000)
  const cutoffText = nowTextFromDate(cutoff)
  const before = store.logs.length
  store.logs = store.logs.filter((l) => l.time >= cutoffText)
  if (store.logs.length > LOG_LIMIT) store.logs.length = LOG_LIMIT
  return store.logs.length !== before
}

export function touchPush(channel: PushChannel, running = false) {
  const now = nowText()
  channel.updatedAt = now
  channel.lastActiveAt = now
  if (running) channel.status = 'running'
}

function normalizeLog(raw: any): LogEntry {
  const now = nowText()
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : nextId('log'),
    level: ['debug', 'info', 'warn', 'error'].includes(raw?.level) ? raw.level : 'info',
    source: typeof raw?.source === 'string' ? raw.source : 'System',
    message: typeof raw?.message === 'string' ? raw.message : String(raw?.message ?? ''),
    deviceId: typeof raw?.deviceId === 'string' ? raw.deviceId : undefined,
    tagId: typeof raw?.tagId === 'string' ? raw.tagId : undefined,
    time: typeof raw?.time === 'string' && raw.time
      ? raw.time
      : (typeof raw?.ts === 'string' && raw.ts ? raw.ts : now),
  }
}

export function closeDb() {
  try {
    db.close()
  } catch (e) {
    console.error('关闭数据库失败', e)
  }
}