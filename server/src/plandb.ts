/**
 * 卷曲计划号 → 产品规格（ProductName）查询
 *
 * 数据源：172.19.29.6 / ZODO_MesPartsConnection / dbo.MesDownPlan
 *   PlanNo（计划号，PLC 点位 MES_WIND1_PLAN / MES_WIND2_PLAN 的值）→ ProductName（规格）
 *
 * 配置文件：data/plan.json（可热改，重启生效）
 */
import fs from 'node:fs'
import path from 'node:path'
import sql from 'mssql'

export interface PlanDbConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  password: string
  database: string
  table: string
  cacheSeconds: number
}

const DEFAULTS: PlanDbConfig = {
  enabled: true,
  host: '172.19.29.6',
  port: 1433,
  user: 'admin',
  password: 'zodo!@123.com',
  database: 'ZODO_MesPartsConnection',
  table: 'MesDownPlan',
  cacheSeconds: 300,
}

const CONFIG_PATH = path.resolve('data/plan.json')

let cfgCache: { ts: number; cfg: PlanDbConfig } | null = null

export function getPlanConfig(): PlanDbConfig {
  // 10 秒内复用，避免每次推送都读文件
  if (cfgCache && Date.now() - cfgCache.ts < 10_000) return cfgCache.cfg
  let cfg = { ...DEFAULTS }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<PlanDbConfig>
      cfg = { ...cfg, ...raw }
    }
  } catch (e) {
    console.error('[Plan] 读取 data/plan.json 失败，使用默认配置:', (e as Error).message)
  }
  // 表名只允许字母数字下划线，避免拼接注入
  cfg.table = String(cfg.table || 'MesDownPlan').replace(/[^A-Za-z0-9_]/g, '')
  cfgCache = { ts: Date.now(), cfg }
  return cfg
}

// ── 连接池（懒加载，失败后允许重建）──────────────────────────
let poolPromise: Promise<sql.ConnectionPool> | null = null

async function getPool(cfg: PlanDbConfig): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool({
      server: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 3, min: 0, idleTimeoutMillis: 30_000 },
      connectionTimeout: 5_000,
      requestTimeout: 8_000,
    })
    poolPromise = pool.connect().catch((e) => {
      poolPromise = null
      throw e
    })
  }
  return poolPromise
}

// ── 结果缓存：planNo → ProductName ───────────────────────────
const cache = new Map<string, { value: string | null; ts: number }>()

/**
 * 按计划号查产品规格（ProductName）。
 * 命中缓存直接返回；查不到返回 undefined。
 *
 * 容错：PLC 端 STRING 偶发首字符丢失（如 261026083_10967 被写成 61026083_10967），
 * 精确匹配失败时再用右对齐模糊匹配兜底。
 */
export async function lookupProductName(planNo: string): Promise<string | undefined> {
  const cfg = getPlanConfig()
  if (!cfg.enabled) return undefined

  const key = String(planNo || '').trim()
  if (!key) return undefined

  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < cfg.cacheSeconds * 1000) return hit.value ?? undefined

  try {
    const pool = await getPool(cfg)
    let name: string | null = null

    const r1 = await pool
      .request()
      .input('pn', sql.NVarChar(64), key)
      .query(`SELECT TOP 1 ProductName FROM dbo.${cfg.table} WHERE PlanNo = @pn ORDER BY PlanDate DESC`)
    name = (r1.recordset?.[0]?.ProductName as string | undefined) ?? null

    if (!name && key.length >= 8) {
      const r2 = await pool
        .request()
        .input('pn', sql.NVarChar(64), key)
        .query(
          `SELECT TOP 1 ProductName FROM dbo.${cfg.table}
           WHERE PlanNo LIKE '%' + @pn
             AND LEN(PlanNo) <= LEN(@pn) + 4
             AND PlanDate >= DATEADD(day, -3, GETDATE())
           ORDER BY PlanDate DESC`,
        )
      name = (r2.recordset?.[0]?.ProductName as string | undefined) ?? null
      if (name) console.warn(`[Plan] 计划号 ${key} 精确匹配失败，模糊匹配到规格 ${name}`)
    }

    cache.set(key, { value: name, ts: Date.now() })
    return name ?? undefined
  } catch (e) {
    console.error('[Plan] 查询 ProductName 失败:', key, '→', (e as Error).message)
    // 30 秒后允许重试，避免短时间内反复打库
    cache.set(key, { value: null, ts: Date.now() - cfg.cacheSeconds * 1000 + 30_000 })
    return undefined
  }
}

/** 清理过期缓存（防止长时间运行内存堆积） */
export function prunePlanCache(): void {
  const ttl = getPlanConfig().cacheSeconds * 1000
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.ts > ttl * 4) cache.delete(k)
}
