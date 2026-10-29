import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../../data')
const dbPath = resolve(dataDir, 'plc.db')

console.log('准备导入数据...')
console.log('目标数据库文件:', dbPath)

// 直接连数据库，不经过 store.ts
const db = new DatabaseSync(dbPath)

// 确保表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, deviceId TEXT NOT NULL, data TEXT NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_channels (id TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt TEXT NOT NULL);
`)

function readJson(name: string) {
  const file = resolve(dataDir, name)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (e) {
    console.error(`读取 ${name} 失败:`, e)
    return undefined
  }
}

function run() {
  const now = new Date().toISOString()
  let countD = 0, countT = 0

  // 1. 导入设备
  const devices = readJson('devices.json')
  if (Array.isArray(devices) && devices.length > 0) {
    db.exec('DELETE FROM devices') // 先清空旧数据
    const ins = db.prepare('INSERT INTO devices (id, data, updatedAt) VALUES (?, ?, ?)')
    for (const d of devices) {
      ins.run(d.id, JSON.stringify(d), now)
      countD++
    }
    console.log(`- 已写入 ${countD} 个设备到数据库`)
  }

  // 2. 导入点位
  const tags = readJson('tags.json')
  if (Array.isArray(tags) && tags.length > 0) {
    db.exec('DELETE FROM tags')
    const ins = db.prepare('INSERT INTO tags (id, deviceId, data, updatedAt) VALUES (?, ?, ?, ?)')
    for (const t of tags) {
      ins.run(t.id, t.deviceId, JSON.stringify(t), now)
      countT++
    }
    console.log(`- 已写入 ${countT} 个点位到数据库`)
  }

  // 3. 验证是否真的进去了
  const checkD = db.prepare('SELECT COUNT(*) AS n FROM devices').get() as any
  const checkT = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as any
  
  console.log(`✅ 验证结果：库中实际有 ${checkD.n} 个设备，${checkT.n} 个点位。`)
  
  // 强制关闭连接
  db.close()
}

run()