import { addLog, getStore, nowText, saveStore, touchDevice } from './store.ts'
import { broadcast } from './bus.ts'
import { createDriver } from './protocols/index.ts'
import type { Device, Tag } from './types.ts'

const drivers = new Map<string, ReturnType<typeof createDriver>>
const timers = new Map<string, NodeJS.Timeout>()
const lastErrorLog = new Map<string, number>()
const polling = new Set<string>()
const queue: string[] = []
const queued = new Set<string>()
let inFlight = 0
let dirty = false
let persistTimer: NodeJS.Timeout | null = null

function emitLog(level: 'debug' | 'info' | 'warn' | 'error', source: string, message: string, extra?: { deviceId?: string; tagId?: string }) {
  const settings = getStore().settings
  const rank = { debug: 0, info: 1, warn: 2, error: 3 }
  if (rank[level] < rank[settings.logLevel]) return
  const log = addLog({ level, source, message, ...extra })
  broadcast({ type: 'log', data: log })
  return log
}

function throttleError(key: string, ms = 15000) {
  const now = Date.now()
  const last = lastErrorLog.get(key) ?? 0
  if (now - last < ms) return false
  lastErrorLog.set(key, now)
  return true
}

function schedulePersist() {
  dirty = true
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    if (!dirty) return
    dirty = false
    saveStore()
  }, 800)
}

function setDeviceStatus(device: Device, status: Device['status']) {
  const changed = device.status !== status
  device.status = status
  if (status === 'online') touchDevice(device, true)
  else device.updatedAt = nowText()
  if (!changed && status !== 'online') return
  schedulePersist()
  broadcast({ type: 'device', data: { ...device } })
}

function enqueue(deviceId: string) {
  if (queued.has(deviceId) || polling.has(deviceId)) return
  queued.add(deviceId)
  queue.push(deviceId)
  void pump()
}

async function pump() {
  const maxConcurrent = Math.max(1, getStore().settings.maxConcurrent || 10)
  while (inFlight < maxConcurrent && queue.length) {
    const deviceId = queue.shift()
    if (!deviceId) break
    queued.delete(deviceId)
    inFlight += 1
    void pollDevice(deviceId).finally(() => {
      inFlight = Math.max(0, inFlight - 1)
      void pump()
    })
  }
}

async function pollDevice(deviceId: string) {
  if (polling.has(deviceId)) return
  polling.add(deviceId)
  const store = getStore()
  const device = store.devices.find((item) => item.id === deviceId)
  try {
    if (!device?.enabled) {
      if (device && device.status === 'online') setDeviceStatus(device, 'offline')
      return
    }

    const tags = store.tags.filter((item) => item.deviceId === device.id && item.enabled)

    let driver = drivers.get(device.id)
    if (!driver) {
      driver = createDriver(device)
      drivers.set(device.id, driver)
    }

    try {
      await driver.probe()
      setDeviceStatus(device, 'online')
      let changed = false
      let allFailed = tags.length > 0

      for (const tag of tags) {
        try {
          const value = await driver.readTag(tag)
          tag.currentValue = value
          tag.quality = 'good'
          tag.lastUpdate = nowText()
          changed = true
          allFailed = false
          broadcast({ type: 'tag', data: { ...tag } })
        } catch (error) {
          tag.quality = 'bad'
          tag.lastUpdate = nowText()
          changed = true
          broadcast({ type: 'tag', data: { ...tag } })
          if (throttleError(`tag-${tag.id}`)) {
            emitLog('warn', 'Poll', `点位 [${tag.name}] 读取失败: ${(error as Error).message}`, {
              deviceId: device.id,
              tagId: tag.id,
            })
          }
        }
      }


      // 所有点位都失败 → 认定设备掉线，清掉驱动，下一轮重建
      if (allFailed) {
        setDeviceStatus(device, 'offline')
        await driver.close().catch(() => undefined)
        drivers.delete(device.id)
        if (throttleError(`dev-${device.id}`)) {
          emitLog('error', 'Collector', `设备 [${device.name}] 全部点位读取失败，已重置连接`, { deviceId: device.id })
        }
      }
    } catch (error) {
      setDeviceStatus(device, 'offline')
      await driver.close().catch(() => undefined)
      drivers.delete(device.id)
      if (throttleError(`dev-${device.id}`)) {
        emitLog('error', 'Collector', `设备 [${device.name}] 连接失败: ${(error as Error).message}`, { deviceId: device.id })
      }
    }
  } finally {
    polling.delete(deviceId)
  }
}

function schedule(device: Device) {
  stopOne(device.id)
  if (!device.enabled) return
  const settings = getStore().settings
  const interval = Math.max(200, device.pollInterval || settings.globalPollInterval || 1000)
  const reconnect = Math.max(1000, settings.reconnectInterval || 5000)

  const tick = () => {
    const current = getStore().devices.find((item) => item.id === device.id)
    if (!current?.enabled) return
    if (!settings.autoReconnect && current.status === 'offline') return
    enqueue(current.id)
    const wait = current.status === 'offline' ? reconnect : interval
    timers.set(current.id, setTimeout(tick, wait))
  }

  tick()
}

function stopOne(id: string) {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

export async function testDevice(device: Device) {
  const driver = createDriver(device)
  const timeout = Math.max(500, device.timeout || 3000)
  const timer = setTimeout(() => { void driver.close() }, timeout + 500)
  try {
    await driver.probe()
    const target = device.host ? `${device.host}:${device.port || 502}` : device.serialPort || ''
    return `已收到 ${target} 的应答`
  } finally {
    clearTimeout(timer)
    await driver.close()
  }
}

export async function writeTagValue(tagId: string, value: string | number | boolean) {
  const store = getStore()
  const tag = store.tags.find((item) => item.id === tagId)
  if (!tag) throw new Error('点位不存在')
  if (tag.accessMode === 'read') throw new Error('该点位为只读')
  const device = store.devices.find((item) => item.id === tag.deviceId)
  if (!device) throw new Error('所属设备不存在')

  let driver = drivers.get(device.id)
  if (!driver) {
    driver = createDriver(device)
    drivers.set(device.id, driver)
  }
  await driver.connect()
  await driver.writeTag(tag, value)
  tag.currentValue = value
  tag.quality = 'good'
  tag.lastUpdate = nowText()
  touchDevice(device, true)
  saveStore()
  broadcast({ type: 'tag', data: { ...tag } })
  emitLog('info', 'Write', `点位 [${tag.name}] 写入 ${String(value)}`, { deviceId: device.id, tagId: tag.id })
  return tag
}

export function syncCollector() {
  const { devices } = getStore()
  const enabledIds = new Set(devices.filter((item) => item.enabled).map((item) => item.id))
  for (const id of [...timers.keys()]) {
    if (!enabledIds.has(id)) {
      stopOne(id)
      const driver = drivers.get(id)
      void driver?.close()
      drivers.delete(id)
    }
  }
  for (const device of devices) {
    if (!device.enabled) {
      if (device.status === 'online') setDeviceStatus(device, 'offline')
      continue
    }
    const existing = drivers.get(device.id)
    if (existing) {
      void existing.close()
      drivers.delete(device.id)
    }
    schedule({ ...device })
  }
}

export function stopCollector() {
  for (const id of [...timers.keys()]) stopOne(id)
  queue.length = 0
  queued.clear()
  for (const [id, driver] of drivers) {
    void driver.close()
    drivers.delete(id)
  }
}

export function markTag(tag: Tag) {
  broadcast({ type: 'tag', data: { ...tag } })
}
