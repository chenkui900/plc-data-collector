import type { Device } from '../types.ts'
import type { PlcDriver } from './base.ts'
import { BacnetDriver } from './bacnet.ts'
import { CoapDriver } from './coap.ts'
import { Dnp3Driver } from './dnp3.ts'
import { EnipDriver } from './enip.ts'
import { FinsDriver } from './fins.ts'
import { HcpDriver } from './hcp.ts'
import { Iec104Driver } from './iec104.ts'
import { McProtocolDriver } from './mc-protocol.ts'
import { isModbus, ModbusDriver } from './modbus.ts'
import { MqttSourceDriver } from './mqtt.ts'
import { OpcUaDriver } from './opcua.ts'
import { S7Driver } from './s7.ts'
import { StubDriver } from './stub.ts'
import { EnipNodeDriver } from './enip-node.ts'

export { BaseDriver } from './base.ts'
export type { PlcDriver } from './base.ts'
export { isModbus }

const S7_PROTOCOLS = new Set(['s7-1200', 's7-1500', 's7-300', 's7-400'])

/** 已实现驱动、可直接采集的协议 */
export function isSupported(protocol: string) {
  return (
    isModbus(protocol) ||
    S7_PROTOCOLS.has(protocol) ||
    protocol === 'mc-protocol' ||
    protocol === 'inovance-tcp' ||
    protocol === 'inovance-rtu' ||
    protocol === 'inovance-hcp' ||
    protocol === 'fins' ||
    protocol === 'ethernet-ip' ||
    protocol === 'bacnet' ||
    protocol === 'dnp3' ||
    protocol === 'iec104' ||
    protocol === 'mqtt' ||
    protocol === 'coap' ||
    protocol === 'opc-ua'
  )
}

export function createDriver(device: Device): PlcDriver {
  // 汇川以太网/串口 PLC 采用标准 Modbus，直接复用 Modbus 驱动
  if (isModbus(device.protocol) || device.protocol === 'inovance-tcp' || device.protocol === 'inovance-rtu') {
    return new ModbusDriver(device)
  }
  if (S7_PROTOCOLS.has(device.protocol)) return new S7Driver(device)
  if (device.protocol === 'mc-protocol') return new McProtocolDriver(device)
  if (device.protocol === 'inovance-hcp') return new HcpDriver(device)
  if (device.protocol === 'fins') return new FinsDriver(device)
  if (device.protocol === 'ethernet-ip') return new EnipNodeDriver(device)
  if (device.protocol === 'bacnet') return new BacnetDriver(device)
  if (device.protocol === 'dnp3') return new Dnp3Driver(device)
  if (device.protocol === 'iec104') return new Iec104Driver(device)
  if (device.protocol === 'mqtt') return new MqttSourceDriver(device)
  if (device.protocol === 'coap') return new CoapDriver(device)
  if (device.protocol === 'opc-ua') return new OpcUaDriver(device)
  // OPC DA 依赖 Windows COM/DCOM，PROFINET 为二层实时以太网，均无法在纯 Node 中实现
  return new StubDriver(device)
}
