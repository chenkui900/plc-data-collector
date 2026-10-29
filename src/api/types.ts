import type { Device, LogEntry, Tag } from '../types'
import type { PushChannel } from '../types/push'

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

export interface Overview {
  devices: Device[]
  tags: Tag[]
  pushChannels: PushChannel[]
  logs: LogEntry[]
  stats: {
    deviceCount: number
    onlineCount: number
    tagCount: number
    enabledTags: number
    pushCount: number
    runningPush: number
  }
}

export type RealtimeMessage =
  | { type: 'hello'; data: Overview | { devices: Device[]; tags: Tag[]; pushChannels: PushChannel[]; logs: LogEntry[]; settings?: AppSettings } }
  | { type: 'tag'; data: Tag }
  | { type: 'device'; data: Device }
  | { type: 'push'; data: PushChannel }
  | { type: 'log'; data: LogEntry }
  | { type: 'settings'; data: AppSettings }
