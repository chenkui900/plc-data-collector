import type { Device, Tag } from '../types.ts'

export interface PlcDriver {
  readonly connected: boolean
  connect(): Promise<void>
  probe(): Promise<void>
  readTag(tag: Tag): Promise<string | number | boolean>
  writeTag(tag: Tag, value: string | number | boolean): Promise<void>
  close(): Promise<void>
}

export abstract class BaseDriver implements PlcDriver {
  constructor(protected device: Device) {}

  get timeoutMs() {
    return Math.max(500, this.device.timeout || 3000)
  }

  abstract get connected(): boolean
  abstract connect(): Promise<void>
  abstract probe(): Promise<void>
  abstract readTag(tag: Tag): Promise<string | number | boolean>
  abstract writeTag(tag: Tag, value: string | number | boolean): Promise<void>
  abstract close(): Promise<void>
}
