export type ProtocolType =
  | 'modbus-tcp'
  | 'modbus-rtu'
  | 'modbus-ascii'
  | 's7-1200'
  | 's7-1500'
  | 's7-300'
  | 's7-400'
  | 'opc-ua'
  | 'opc-da'
  | 'mc-protocol'
  | 'inovance-tcp'
  | 'inovance-rtu'
  | 'inovance-hcp'
  | 'fins'
  | 'ethernet-ip'
  | 'profinet'
  | 'bacnet'
  | 'dnp3'
  | 'iec104'
  | 'mqtt'
  | 'coap'

export type DataType =
  | 'bool'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64'
  | 'string'
  | 'byte'
  | 'word'
  | 'dword'

export type ByteOrder = 'AB' | 'BA' | 'ABCD' | 'CDAB' | 'BADC' | 'DCBA'
export type AccessMode = 'read' | 'write' | 'readwrite'
export type DeviceStatus = 'online' | 'offline' | 'error' | 'unknown'
export type PushType = 'mqtt' | 'tcp' | 'http' | 'mysql'

export interface Device {
  id: string
  name: string
  protocol: ProtocolType
  enabled: boolean
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  slaveId?: number
  rack?: number
  slot?: number
  timeout: number
  pollInterval: number
  description?: string
  tagCount: number
  status: DeviceStatus
  lastConnected?: string
  createdAt?: string
  updatedAt?: string
  lastActiveAt?: string
}

export interface Tag {
  id: string
  name: string
  deviceId: string
  deviceName: string
  address: string
  functionCode?: string
  dataType: DataType
  byteOrder: ByteOrder
  accessMode: AccessMode
  scale: number
  offset: number
  unit?: string
  group?: string
  enabled: boolean
  description?: string
  currentValue?: string | number | boolean
  quality: 'good' | 'bad' | 'uncertain'
  lastUpdate?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  deviceId?: string
  tagId?: string
}

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
  broker?: string
  port?: number
  topic?: string
  clientId?: string
  username?: string
  password?: string
  qos?: 0 | 1 | 2
  retain?: boolean
  host?: string
  tcpPort?: number
  format?: 'json' | 'plain' | 'csv'
  delimiter?: string
  url?: string
  method?: 'POST' | 'PUT'
  contentType?: string
  headers?: string
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

export interface AppSettings {
  globalPollInterval: number
  maxConcurrent: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logRetention: number
  maxLogEntries: number
  coldDataDays: number
  autoReconnect: boolean
  reconnectInterval: number
  webPort: number
  enableCors: boolean
}

export interface StoreData {
  devices: Device[]
  tags: Tag[]
  pushChannels: PushChannel[]
  logs: LogEntry[]
  settings: AppSettings
}

export type RealtimeMessage =
  | { type: 'hello'; data: StoreData }
  | { type: 'tag'; data: Tag }
  | { type: 'device'; data: Device }
  | { type: 'push'; data: PushChannel }
  | { type: 'log'; data: LogEntry }
  | { type: 'settings'; data: AppSettings }
