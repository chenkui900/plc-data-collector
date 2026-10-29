import type { Tag } from '../types.ts'
import { BaseDriver } from './base.ts'

export class StubDriver extends BaseDriver {
  get connected() {
    return false
  }

  async connect() {
    throw this.notImplemented('连接')
  }

  private notImplemented(feature = '采集'): never {
    const reason =
      this.device.protocol === 'opc-da'
        ? '依赖 Windows COM/DCOM，需 Windows 原生组件'
        : this.device.protocol === 'profinet'
          ? '为二层实时以太网协议，需专用协议栈/硬件'
          : '请选择已支持的协议或扩展驱动'
    throw new Error(`协议 ${this.device.protocol} ${feature}驱动暂未实现（${reason}）`)
  }

  async probe(): Promise<void> {
    this.notImplemented('连接')
  }

  async readTag(_tag: Tag): Promise<string | number | boolean> {
    return this.notImplemented('读取')
  }

  async writeTag(_tag: Tag, _value: string | number | boolean): Promise<void> {
    this.notImplemented('写入')
  }

  async close() {
    // nothing
  }
}
