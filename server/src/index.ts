import http from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { attachWss, broadcast } from './bus.ts'
import { syncCollector, stopCollector, testDevice, writeTagValue } from './collector.ts'
import { syncPusher, stopPusher } from './pusher.ts'
import {
  addLog,
  getStore,
  loadStore,
  nextId,
  nowText,
  pruneColdData,
  refreshTagCounts,
  saveStore,
  touchDevice,
} from './store.ts'
import type { AppSettings, Device, PushChannel, Tag } from './types.ts'

import { spawn } from 'node:child_process'

// =============== 防系统休眠 ===============
let sleepPreventer: any = null

function preventSystemSleep() {
  if (process.platform !== 'win32') return
  
  const psScript = `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PowerUtil { [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern uint SetThreadExecutionState(uint esFlags); }'
    [PowerUtil]::SetThreadExecutionState(0x80000000 -bor 0x00000001)
    while ($true) { Start-Sleep -Seconds 60 }
  `
  console.log('[System] 正在启动防休眠守护进程...')
  sleepPreventer = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
    stdio: 'ignore',
    windowsHide: true
  })
}

function allowSystemSleep() {
  if (sleepPreventer) {
    console.log('[System] 停止防休眠守护进程...')
    sleepPreventer.kill()
    sleepPreventer = null
  }
}
// ========================================


loadStore()

const app = express()
const settings = getStore().settings
if (settings.enableCors) app.use(cors())
app.use(express.json({ limit: '2mb' }))

function reportFatal(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[Plc_Aotu] ${scope}: ${message}`)
  try {
    const log = addLog({ level: 'error', source: 'System', message: `${scope}: ${message}` })
    broadcast({ type: 'log', data: log })
  } catch { /* ignore */ }
}

const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED',
  'EHOSTUNREACH', 'ENETUNREACH',
])

// 同一类网络瞬断，30 秒内只打一行，避免刷屏
let lastTransientAt = 0
let lastTransientCode = ''
function handleTransient(code: string) {
  const now = Date.now()
  if (code !== lastTransientCode || now - lastTransientAt > 30000) {
    lastTransientAt = now
    lastTransientCode = code
    console.warn(`[Plc_Aotu] 网络瞬断（已忽略）: ${code}`)
  }
}

process.on('unhandledRejection', (error) => {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code && TRANSIENT_NET_CODES.has(code)) return handleTransient(code)
  reportFatal('未处理的 Promise 拒绝', error)
})

process.on('uncaughtException', (error) => {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code && TRANSIENT_NET_CODES.has(code)) return handleTransient(code)
  reportFatal('未捕获异常', error)
})

function ok<T>(res: Response, data: T) {
  res.json(data)
}

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ message })
}

function overview() {
  const store = getStore()
  refreshTagCounts()
  pruneColdData()
  return {
    devices: store.devices,
    tags: store.tags,
    pushChannels: store.pushChannels,
    logs: store.logs.slice(0, 50),
    stats: {
      deviceCount: store.devices.length,
      onlineCount: store.devices.filter((item) => item.status === 'online').length,
      tagCount: store.tags.length,
      enabledTags: store.tags.filter((item) => item.enabled).length,
      pushCount: store.pushChannels.length,
      runningPush: store.pushChannels.filter((item) => item.status === 'running').length,
    },
  }
}

app.get('/api/overview', (_req, res) => {
  ok(res, overview())
})

app.get('/api/devices', (_req, res) => {
  refreshTagCounts()
  ok(res, getStore().devices)
})

app.post('/api/devices', (req, res) => {
  const body = req.body as Partial<Device>
  if (!body.name || !body.protocol) return fail(res, 400, '设备名称和协议必填')
  const device: Device = {
    id: nextId('dev'),
    name: body.name,
    protocol: body.protocol,
    enabled: body.enabled ?? true,
    host: body.host,
    port: body.port,
    serialPort: body.serialPort,
    baudRate: body.baudRate,
    slaveId: body.slaveId,
    rack: body.rack,
    slot: body.slot,
    timeout: body.timeout ?? 3000,
    pollInterval: body.pollInterval ?? getStore().settings.globalPollInterval,
    description: body.description,
    tagCount: 0,
    status: 'unknown',
    createdAt: nowText(),
    updatedAt: nowText(),
    lastActiveAt: nowText(),
  }
  getStore().devices.push(device)
  saveStore()
  const log = addLog({ level: 'info', source: 'Device', message: `添加设备 [${device.name}]`, deviceId: device.id })
  broadcast({ type: 'log', data: log })
  broadcast({ type: 'device', data: device })
  syncCollector()
  ok(res, device)
})

app.put('/api/devices/:id', (req, res) => {
  const store = getStore()
  const device = store.devices.find((item) => item.id === req.params.id)
  if (!device) return fail(res, 404, '设备不存在')
  Object.assign(device, req.body, { id: device.id })
  if (typeof device.pollInterval !== 'number') device.pollInterval = getStore().settings.globalPollInterval
  if (typeof device.timeout !== 'number') device.timeout = 3000
  touchDevice(device)
  saveStore()
  broadcast({ type: 'device', data: device })
  syncCollector()
  ok(res, device)
})

app.patch('/api/devices/:id', (req, res) => {
  const device = getStore().devices.find((item) => item.id === req.params.id)
  if (!device) return fail(res, 404, '设备不存在')
  Object.assign(device, req.body, { id: device.id })
  touchDevice(device)
  saveStore()
  broadcast({ type: 'device', data: device })
  syncCollector()
  ok(res, device)
})

app.delete('/api/devices/:id', (req, res) => {
  const store = getStore()
  const index = store.devices.findIndex((item) => item.id === req.params.id)
  if (index < 0) return fail(res, 404, '设备不存在')
  const [device] = store.devices.splice(index, 1)
  store.tags = store.tags.filter((tag) => tag.deviceId !== device.id)
  refreshTagCounts()
  saveStore()
  const log = addLog({ level: 'info', source: 'Device', message: `删除设备 [${device.name}]`, deviceId: device.id })
  broadcast({ type: 'log', data: log })
  syncCollector()
  ok(res, { ok: true })
})

app.post('/api/devices/:id/test', async (req, res) => {
  const device = getStore().devices.find((item) => item.id === req.params.id)
  if (!device) return fail(res, 404, '设备不存在')
  try {
    const message = await testDevice(device)
    const log = addLog({ level: 'info', source: 'Device', message: `设备 [${device.name}] ${message}`, deviceId: device.id })
    broadcast({ type: 'log', data: log })
    ok(res, { ok: true, message })
  } catch (error) {
    const message = (error as Error).message
    const log = addLog({ level: 'error', source: 'Device', message: `设备 [${device.name}] 连接失败: ${message}`, deviceId: device.id })
    broadcast({ type: 'log', data: log })
    fail(res, 400, message)
  }
})

app.get('/api/tags', (req, res) => {
  const deviceId = String(req.query.deviceId || '')
  const q = String(req.query.q || '').toLowerCase()
  let tags = getStore().tags
  if (deviceId) tags = tags.filter((tag) => tag.deviceId === deviceId)
  if (q) {
    tags = tags.filter((tag) =>
      tag.name.toLowerCase().includes(q) ||
      tag.address.toLowerCase().includes(q) ||
      tag.deviceName.toLowerCase().includes(q)
    )
  }
  ok(res, tags)
})

app.post('/api/tags', (req, res) => {
  const body = req.body as Partial<Tag>
  if (!body.name || !body.deviceId || !body.address) return fail(res, 400, '点位名称、设备和地址必填')
  const device = getStore().devices.find((item) => item.id === body.deviceId)
  const tag: Tag = {
    id: nextId('tag'),
    name: body.name,
    deviceId: body.deviceId,
    deviceName: device?.name ?? body.deviceName ?? '',
    address: body.address,
    functionCode: body.functionCode,
    dataType: body.dataType ?? 'float32',
    byteOrder: body.byteOrder ?? 'ABCD',
    accessMode: body.accessMode ?? 'read',
    scale: body.scale ?? 1,
    offset: body.offset ?? 0,
    unit: body.unit,
    group: body.group,
    enabled: body.enabled ?? true,
    description: body.description,
    quality: 'uncertain',
  }
  const owner = getStore().devices.find((item) => item.id === tag.deviceId)
  if (owner) touchDevice(owner)
  getStore().tags.push(tag)
  refreshTagCounts()
  saveStore()
  const log = addLog({ level: 'info', source: 'Tag', message: `添加点位 [${tag.name}]`, tagId: tag.id, deviceId: tag.deviceId })
  broadcast({ type: 'log', data: log })
  broadcast({ type: 'tag', data: tag })
  syncCollector()
  ok(res, tag)
})

app.post('/api/tags/import', (req, res) => {
  const body = req.body as { tags?: Partial<Tag>[] }
  const items = Array.isArray(body.tags) ? body.tags : []
  if (!items.length) return fail(res, 400, '没有可导入的点位')
  const created: Tag[] = []
  const errors: string[] = []
  for (const [index, item] of items.entries()) {
    if (!item.name || !item.deviceId || !item.address) {
      errors.push(`第 ${index + 1} 行缺少名称、设备或地址`)
      continue
    }
    const device = getStore().devices.find((d) => d.id === item.deviceId || d.name === item.deviceName || d.name === item.deviceId)
    if (!device) {
      errors.push(`第 ${index + 1} 行设备不存在: ${item.deviceName || item.deviceId}`)
      continue
    }
    const exists = getStore().tags.some((tag) => tag.deviceId === device.id && tag.address === item.address && (tag.functionCode || '') === (item.functionCode || ''))
    if (exists) {
      errors.push(`第 ${index + 1} 行点位已存在: ${item.name} / ${item.address}`)
      continue
    }
    const tag: Tag = {
      id: nextId('tag'),
      name: item.name,
      deviceId: device.id,
      deviceName: device.name,
      address: item.address,
      functionCode: item.functionCode,
      dataType: item.dataType ?? 'int16',
      byteOrder: item.byteOrder ?? 'AB',
      accessMode: item.accessMode ?? 'read',
      scale: item.scale ?? 1,
      offset: item.offset ?? 0,
      unit: item.unit,
      enabled: item.enabled ?? true,
      quality: 'uncertain',
    }
    getStore().tags.push(tag)
    created.push(tag)
    broadcast({ type: 'tag', data: tag })
  }
  if (created.length) {
    refreshTagCounts()
    saveStore()
    const log = addLog({ level: 'info', source: 'Tag', message: `导入点位 ${created.length} 个` })
    broadcast({ type: 'log', data: log })
    syncCollector()
  }
  ok(res, { created: created.length, failed: errors.length, errors, tags: created })
})

app.put('/api/tags/:id', (req, res) => {
  const tag = getStore().tags.find((item) => item.id === req.params.id)
  if (!tag) return fail(res, 404, '点位不存在')
  Object.assign(tag, req.body, { id: tag.id })
  const device = getStore().devices.find((item) => item.id === tag.deviceId)
  if (device) tag.deviceName = device.name
  saveStore()
  broadcast({ type: 'tag', data: tag })
  syncCollector()
  ok(res, tag)
})

app.patch('/api/tags/:id', (req, res) => {
  const tag = getStore().tags.find((item) => item.id === req.params.id)
  if (!tag) return fail(res, 404, '点位不存在')
  Object.assign(tag, req.body, { id: tag.id })
  saveStore()
  broadcast({ type: 'tag', data: tag })
  syncCollector()
  ok(res, tag)
})

app.post('/api/tags/:id/write', async (req, res) => {
  try {
    const value = (req.body as { value?: string | number | boolean }).value
    if (value === undefined) return fail(res, 400, '写入值必填')
    const tag = await writeTagValue(req.params.id, value)
    ok(res, tag)
  } catch (error) {
    fail(res, 400, (error as Error).message)
  }
})

app.delete('/api/tags/:id', (req, res) => {
  const store = getStore()
  const index = store.tags.findIndex((item) => item.id === req.params.id)
  if (index < 0) return fail(res, 404, '点位不存在')
  const [tag] = store.tags.splice(index, 1)
  refreshTagCounts()
  saveStore()
  const log = addLog({ level: 'info', source: 'Tag', message: `删除点位 [${tag.name}]`, tagId: tag.id })
  broadcast({ type: 'log', data: log })
  ok(res, { ok: true })
})

app.get('/api/push', (_req, res) => ok(res, getStore().pushChannels))

app.post('/api/push', (req, res) => {
  const body = req.body as Partial<PushChannel>
  if (!body.name || !body.type) return fail(res, 400, '通道名称和类型必填')
  const channel: PushChannel = {
    id: nextId('push'),
    name: body.name,
    type: body.type,
    enabled: body.enabled ?? true,
    description: body.description,
    tagFilter: body.tagFilter ?? 'all',
    tagGroups: body.tagGroups,
    pushInterval: body.pushInterval ?? 1000,
    status: 'stopped',
    broker: body.broker,
    port: body.port,
    topic: body.topic,
    clientId: body.clientId,
    username: body.username,
    password: body.password,
    qos: body.qos,
    retain: body.retain,
    host: body.host,
    tcpPort: body.tcpPort,
    format: body.format,
    delimiter: body.delimiter,
    url: body.url,
    method: body.method,
    contentType: body.contentType,
    headers: body.headers,
    dbHost: body.dbHost,
    dbPort: body.dbPort,
    database: body.database,
    dbUsername: body.dbUsername,
    dbPassword: body.dbPassword,
    table: body.table,
    batchSize: body.batchSize,
    flushInterval: body.flushInterval,
    createTable: body.createTable,
    createdAt: nowText(),
    updatedAt: nowText(),
    lastActiveAt: nowText(),
  }
  getStore().pushChannels.push(channel)
  saveStore()
  broadcast({ type: 'push', data: channel })
  syncPusher()
  ok(res, channel)
})

app.put('/api/push/:id', (req, res) => {
  const channel = getStore().pushChannels.find((item) => item.id === req.params.id)
  if (!channel) return fail(res, 404, '推送通道不存在')
  Object.assign(channel, req.body, { id: channel.id })
  channel.updatedAt = nowText()
  channel.lastActiveAt = nowText()
  saveStore()
  broadcast({ type: 'push', data: channel })
  syncPusher()
  ok(res, channel)
})

app.patch('/api/push/:id', (req, res) => {
  const channel = getStore().pushChannels.find((item) => item.id === req.params.id)
  if (!channel) return fail(res, 404, '推送通道不存在')
  Object.assign(channel, req.body, { id: channel.id })
  channel.updatedAt = nowText()
  channel.lastActiveAt = nowText()
  saveStore()
  broadcast({ type: 'push', data: channel })
  syncPusher()
  ok(res, channel)
})

app.delete('/api/push/:id', (req, res) => {
  const store = getStore()
  const index = store.pushChannels.findIndex((item) => item.id === req.params.id)
  if (index < 0) return fail(res, 404, '推送通道不存在')
  store.pushChannels.splice(index, 1)
  saveStore()
  syncPusher()
  ok(res, { ok: true })
})

app.get('/api/logs', (req, res) => {
  pruneColdData()
  const level = String(req.query.level || '')
  const source = String(req.query.source || '')
  const q = String(req.query.q || '').toLowerCase()
  const limit = Number(req.query.limit || 500)
  let logs = getStore().logs
  if (level) logs = logs.filter((item) => item.level === level)
  if (source) logs = logs.filter((item) => item.source === source)
  if (q) logs = logs.filter((item) => item.message.toLowerCase().includes(q))
  ok(res, logs.slice(0, Number.isFinite(limit) ? limit : 500))
})

app.delete('/api/logs', (_req, res) => {
  getStore().logs = []
  saveStore()
  ok(res, { ok: true })
})

app.get('/api/settings', (_req, res) => ok(res, getStore().settings))

app.put('/api/settings', (req, res) => {
  const body = req.body as Partial<AppSettings>
  Object.assign(getStore().settings, body)
  pruneColdData()
  saveStore(true)
  broadcast({ type: 'settings', data: getStore().settings })
  const log = addLog({ level: 'info', source: 'Settings', message: '系统设置已保存' })
  broadcast({ type: 'log', data: log })
  syncCollector()
  ok(res, getStore().settings)
})

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  fail(res, 500, error.message || '服务器错误')
})

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/|\/ws$).*/, (_req, res) => {
    res.sendFile(resolve(distDir, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
attachWss(wss)

const port = Number(process.env.PORT) || getStore().settings.webPort || 8080
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Plc_Aotu] 端口 ${port} 已被占用，请先关闭占用该端口的进程后再启动`)
    process.exit(1)
  }
  reportFatal('HTTP 服务异常', error)
})
server.listen(port, () => {
  preventSystemSleep()
  pruneColdData()
  const log = addLog({
    level: 'info',
    source: 'System',
    message: `采集服务已启动，端口 ${port}，设备 ${getStore().devices.length} 台，点位 ${getStore().tags.length} 个`,
  })
  broadcast({ type: 'log', data: log })
  syncCollector()
  syncPusher()
  setInterval(() => {
    if (pruneColdData()) saveStore()
  }, 60 * 60 * 1000)
  console.log(`[Plc_Aotu] API http://127.0.0.1:${port}`)
})

function shutdown() {
  // 恢复系统休眠
  allowSystemSleep()
  
  stopCollector()
  stopPusher()
  saveStore(true)
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
