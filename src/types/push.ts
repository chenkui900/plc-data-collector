/** 推送类型 */
export type PushType = 'mqtt' | 'tcp' | 'http' | 'mysql'

/** 推送通道 */
export interface PushChannel {
  id: string
  name: string
  type: PushType
  enabled: boolean
  description?: string
  tagFilter?: 'all' | 'group' | 'selected'
  tagGroups?: string[]
  pushInterval: number
  lastPush?: string
  status: 'running' | 'stopped' | 'error'
  createdAt?: string
  updatedAt?: string
  lastActiveAt?: string
  // MQTT
  broker?: string
  port?: number
  topic?: string
  clientId?: string
  username?: string
  password?: string
  qos?: 0 | 1 | 2
  retain?: boolean
  // TCP
  host?: string
  tcpPort?: number
  format?: 'json' | 'plain' | 'csv'
  delimiter?: string
  // HTTP
  url?: string
  method?: 'POST' | 'PUT'
  contentType?: string
  headers?: string
  // MySQL
  dbHost?: string
  dbPort?: number
  database?: string
  dbUsername?: string
  dbPassword?: string
  table?: string
  batchSize?: number
  flushInterval?: number
  createTable?: boolean
}
