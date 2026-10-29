/** 工业协议类型 */
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

/** 数据类型 */
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

/** 字节序 */
export type ByteOrder = 'AB' | 'BA' | 'ABCD' | 'CDAB' | 'BADC' | 'DCBA'

/** 读写权限 */
export type AccessMode = 'read' | 'write' | 'readwrite'

/** 设备 */
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
  status: 'online' | 'offline' | 'error' | 'unknown'
  lastConnected?: string
  createdAt?: string
  updatedAt?: string
  lastActiveAt?: string
}

/** 点位 */
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

/** 日志 */
export interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  deviceId?: string
  tagId?: string
}

/** 协议配置定义 */
export interface ProtocolConfig {
  type: ProtocolType
  name: string
  category: string
  description: string
  supportedDataTypes: DataType[]
  defaultByteOrders: ByteOrder[]
  addressFormat: string
  addressExample: string
  functionCodeLabel?: string
  functionCodes?: FunctionCodeOption[]
  connectionFields: ConnectionField[]
}

export interface FunctionCodeOption {
  value: string
  label: string
  dataTypeHint?: DataType
}

export interface ConnectionField {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  required: boolean
  options?: { label: string; value: string | number }[]
  defaultValue?: string | number
}

export type { PushType, PushChannel } from './push'
