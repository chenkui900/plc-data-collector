import type { DataType, ProtocolConfig } from '../types'

export const modbusFunctionCodes = [
  { value: '01', label: '01 - 读线圈', dataTypeHint: 'bool' as DataType },
  { value: '02', label: '02 - 读离散输入', dataTypeHint: 'bool' as DataType },
  { value: '03', label: '03 - 读保持寄存器' },
  { value: '04', label: '04 - 读输入寄存器' },
]

const s7Areas = [
  { value: 'DB', label: 'DB - 数据块' },
  { value: 'M', label: 'M - 内部标志位' },
  { value: 'I', label: 'I - 输入' },
  { value: 'Q', label: 'Q - 输出' },
  { value: 'T', label: 'T - 定时器' },
  { value: 'C', label: 'C - 计数器' },
]

const mcDevices = [
  { value: 'D', label: 'D - 数据寄存器' },
  { value: 'M', label: 'M - 内部继电器' },
  { value: 'X', label: 'X - 输入继电器' },
  { value: 'Y', label: 'Y - 输出继电器' },
  { value: 'W', label: 'W - 链接寄存器' },
  { value: 'R', label: 'R - 文件寄存器' },
  { value: 'ZR', label: 'ZR - 文件寄存器' },
]

const inovanceDevices = [
  { value: 'D', label: 'D - 数据寄存器' },
  { value: 'M', label: 'M - 内部继电器' },
  { value: 'X', label: 'X - 输入继电器' },
  { value: 'Y', label: 'Y - 输出继电器' },
  { value: 'R', label: 'R - 文件寄存器' },
  { value: 'ZR', label: 'ZR - 扩展文件寄存器' },
  { value: 'W', label: 'W - 链接寄存器' },
  { value: 'S', label: 'S - 步进继电器' },
  { value: 'T', label: 'T - 定时器' },
  { value: 'C', label: 'C - 计数器' },
]

const finsAreas = [
  { value: 'D', label: 'D - 数据内存' },
  { value: 'CIO', label: 'CIO - 通道 IO' },
  { value: 'W', label: 'W - 工作区' },
  { value: 'H', label: 'H - 保持区' },
  { value: 'A', label: 'A - 辅助区' },
]

export const protocolConfigs: ProtocolConfig[] = [
  {
    type: 'modbus-tcp',
    name: 'Modbus TCP',
    category: 'Modbus',
    description: 'Modbus TCP/IP 以太网通讯，适用于大多数 PLC 和仪表',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['AB', 'BA', 'ABCD', 'CDAB', 'BADC', 'DCBA'],
    addressFormat: '寄存器/线圈地址[:位]',
    addressExample: '40001 或 00001:0',
    functionCodeLabel: '功能码',
    functionCodes: modbusFunctionCodes,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 502 },
      { key: 'slaveId', label: '从站 ID', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 'modbus-rtu',
    name: 'Modbus RTU',
    category: 'Modbus',
    description: 'Modbus RTU 串口通讯',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'],
    defaultByteOrders: ['AB', 'BA', 'ABCD', 'CDAB', 'BADC', 'DCBA'],
    addressFormat: '寄存器/线圈地址[:位]',
    addressExample: '40001',
    functionCodeLabel: '功能码',
    functionCodes: modbusFunctionCodes,
    connectionFields: [
      { key: 'serialPort', label: '串口', type: 'text', required: true, defaultValue: 'COM1' },
      { key: 'baudRate', label: '波特率', type: 'select', required: true, defaultValue: 9600, options: [
        { label: '9600', value: 9600 }, { label: '19200', value: 19200 }, { label: '38400', value: 38400 }, { label: '115200', value: 115200 },
      ]},
      { key: 'slaveId', label: '从站 ID', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 'modbus-ascii',
    name: 'Modbus ASCII',
    category: 'Modbus',
    description: 'Modbus ASCII 串口通讯',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'],
    defaultByteOrders: ['AB', 'BA', 'ABCD', 'CDAB', 'BADC', 'DCBA'],
    addressFormat: '寄存器/线圈地址[:位]',
    addressExample: '40001',
    functionCodeLabel: '功能码',
    functionCodes: modbusFunctionCodes,
    connectionFields: [
      { key: 'serialPort', label: '串口', type: 'text', required: true, defaultValue: 'COM1' },
      { key: 'baudRate', label: '波特率', type: 'select', required: true, defaultValue: 9600, options: [
        { label: '9600', value: 9600 }, { label: '19200', value: 19200 }, { label: '38400', value: 38400 }, { label: '115200', value: 115200 },
      ]},
      { key: 'slaveId', label: '从站 ID', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 's7-1200',
    name: 'Siemens S7-1200',
    category: 'Siemens S7',
    description: '西门子 S7-1200，S7comm over ISO-on-TCP（RFC1006）读写 DB/I/Q/M',
    supportedDataTypes: ['bool', 'byte', 'word', 'dword', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'string'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: '区域+偏移[.位]',
    addressExample: 'DB1.DBD0 或 M0.0 或 I0.0',
    functionCodeLabel: '存储区',
    functionCodes: s7Areas,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 102 },
      { key: 'rack', label: '机架号', type: 'number', required: true, defaultValue: 0 },
      { key: 'slot', label: '槽号', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 's7-1500',
    name: 'Siemens S7-1500',
    category: 'Siemens S7',
    description: '西门子 S7-1500，S7comm over ISO-on-TCP（RFC1006）读写 DB/I/Q/M',
    supportedDataTypes: ['bool', 'byte', 'word', 'dword', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: '区域+偏移[.位]',
    addressExample: 'DB10.DBW2 或 Q0.1',
    functionCodeLabel: '存储区',
    functionCodes: s7Areas,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 102 },
      { key: 'rack', label: '机架号', type: 'number', required: true, defaultValue: 0 },
      { key: 'slot', label: '槽号', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 's7-300',
    name: 'Siemens S7-300',
    category: 'Siemens S7',
    description: '西门子 S7-300，S7comm 读写，默认槽号 2',
    supportedDataTypes: ['bool', 'byte', 'word', 'dword', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: '区域+偏移[.位]',
    addressExample: 'DB1.DBW0 或 M0.0',
    functionCodeLabel: '存储区',
    functionCodes: s7Areas,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 102 },
      { key: 'rack', label: '机架号', type: 'number', required: true, defaultValue: 0 },
      { key: 'slot', label: '槽号', type: 'number', required: true, defaultValue: 2 },
    ],
  },
  {
    type: 's7-400',
    name: 'Siemens S7-400',
    category: 'Siemens S7',
    description: '西门子 S7-400，S7comm 读写，默认槽号 3',
    supportedDataTypes: ['bool', 'byte', 'word', 'dword', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: '区域+偏移[.位]',
    addressExample: 'DB1.DBW0 或 M0.0',
    functionCodeLabel: '存储区',
    functionCodes: s7Areas,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 102 },
      { key: 'rack', label: '机架号', type: 'number', required: true, defaultValue: 0 },
      { key: 'slot', label: '槽号', type: 'number', required: true, defaultValue: 3 },
    ],
  },
  {
    type: 'opc-ua',
    name: 'OPC UA',
    category: 'OPC',
    description: 'OPC UA 客户端，按 NodeId 读写 Value 属性（依赖 node-opcua）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'float32', 'float64', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: 'NodeId',
    addressExample: 'ns=2;s=Temperature',
    connectionFields: [
      { key: 'host', label: '服务器地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 4840 },
    ],
  },
  {
    type: 'opc-da',
    name: 'OPC DA',
    category: 'OPC',
    description: 'OPC Data Access，经典 Windows DCOM 方案（依赖 COM 组件，Node 端暂不可实现）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: 'ItemId',
    addressExample: 'Channel1.Device1.Tag1',
    connectionFields: [
      { key: 'host', label: 'OPC 服务器主机', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 5025 },
    ],
  },
  {
    type: 'mc-protocol',
    name: '三菱 MC Protocol',
    category: 'Mitsubishi',
    description: '三菱 PLC MC 协议 3E 帧（二进制）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: '软元件+地址',
    addressExample: 'D100 或 M0 或 X0',
    functionCodeLabel: '软元件',
    functionCodes: mcDevices,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 5000 },
    ],
  },
  {
    type: 'inovance-tcp',
    name: '汇川以太网（Modbus TCP）',
    category: 'Inovance',
    description: '汇川 H3U/H5U/AM/AC 系列以太网口，标准 Modbus TCP（端口 502）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['AB', 'BA', 'ABCD', 'CDAB', 'BADC', 'DCBA'],
    addressFormat: '寄存器/线圈地址[:位]',
    addressExample: '40001 或 00001:0',
    functionCodeLabel: '功能码',
    functionCodes: modbusFunctionCodes,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 502 },
      { key: 'slaveId', label: '从站 ID', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 'inovance-rtu',
    name: '汇川串口（Modbus RTU）',
    category: 'Inovance',
    description: '汇川 H1U/H2U/H3U 串口，标准 Modbus RTU',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'],
    defaultByteOrders: ['AB', 'BA', 'ABCD', 'CDAB', 'BADC', 'DCBA'],
    addressFormat: '寄存器/线圈地址[:位]',
    addressExample: '40001',
    functionCodeLabel: '功能码',
    functionCodes: modbusFunctionCodes,
    connectionFields: [
      { key: 'serialPort', label: '串口', type: 'text', required: true, defaultValue: 'COM1' },
      { key: 'baudRate', label: '波特率', type: 'select', required: true, defaultValue: 9600, options: [
        { label: '9600', value: 9600 }, { label: '19200', value: 19200 }, { label: '38400', value: 38400 }, { label: '115200', value: 115200 },
      ]},
      { key: 'slaveId', label: '从站 ID', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 'inovance-hcp',
    name: '汇川 HCP 私有协议',
    category: 'Inovance',
    description: '汇川 HCP 私有协议（TCP）。帧格式未公开，当前按公开资料实现，如与实际设备不符请按官方帧格式调整',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: '软元件+地址',
    addressExample: 'D100 或 M0 或 X0',
    functionCodeLabel: '软元件',
    functionCodes: inovanceDevices,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 5000 },
      { key: 'slaveId', label: '站号', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    type: 'fins',
    name: 'Omron FINS',
    category: 'Omron',
    description: '欧姆龙 FINS/TCP，D/CIO/W/H/A 区读写（含节点地址握手）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: '区域:地址',
    addressExample: 'D100 或 CIO0.00',
    functionCodeLabel: '区域',
    functionCodes: finsAreas,
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 9600 },
    ],
  },
  {
    type: 'ethernet-ip',
    name: 'EtherNet/IP',
    category: 'Rockwell',
    description: '罗克韦尔 EtherNet/IP，CIP 非连接显式报文按 Tag 名读写',
    supportedDataTypes: [
      'bool',
      'int8', 'uint8',
      'int16', 'uint16',
      'int32', 'uint32',
      'int64', 'uint64',
      'float32', 'float64',
      'string', 'short_string',
    ],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: 'Tag 名称或地址',
    addressExample: 'Program:MainProgram.Temperature',
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 44818 },
      { key: 'slot', label: 'Slot（插槽号）', type: 'number', required: true, defaultValue: 0 },
    ],
  },
  {
    type: 'profinet',
    name: 'PROFINET',
    category: 'Siemens',
    description: 'PROFINET IO 为二层实时以太网（需专用协议栈/硬件，Node 端暂不可实现）',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: 'IO 地址',
    addressExample: 'I0.0 或 QW2',
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 102 },
    ],
  },
  {
    type: 'bacnet',
    name: 'BACnet/IP',
    category: '楼宇自控',
    description: 'BACnet/IP，ReadProperty / WriteProperty 读取 presentValue',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: '对象类型:实例号[:属性]',
    addressExample: 'analog-input:1 或 av:2',
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 47808 },
    ],
  },
  {
    type: 'dnp3',
    name: 'DNP3',
    category: '电力',
    description: 'DNP3 主站，读取 class 0 数据并支持直接操作命令',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'],
    defaultByteOrders: ['ABCD'],
    addressFormat: '点类型+索引',
    addressExample: 'AI0 或 DI1',
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 20000 },
    ],
  },
  {
    type: 'iec104',
    name: 'IEC 60870-5-104',
    category: '电力',
    description: 'IEC 60870-5-104 主站，STARTDT + 总召唤采集，支持单点/设定值命令',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'],
    defaultByteOrders: ['AB', 'ABCD'],
    addressFormat: 'IOA 信息对象地址',
    addressExample: '1001 或 1:1001',
    functionCodeLabel: '类型标识',
    functionCodes: [
      { value: 'M_SP', label: 'M_SP_NA_1 - 单点信息' },
      { value: 'M_ME', label: 'M_ME_NC_1 - 短浮点' },
      { value: 'M_IT', label: 'M_IT_NA_1 - 累计量' },
      { value: 'C_SC', label: 'C_SC_NA_1 - 单点命令' },
    ],
    connectionFields: [
      { key: 'host', label: 'IP 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 2404 },
    ],
  },
  {
    type: 'mqtt',
    name: 'MQTT',
    category: 'IoT',
    description: 'MQTT 设备数据源：订阅主题采集（支持 JSON 取值路径），写入即发布',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: 'Topic 路径或 JSONPath',
    addressExample: 'factory/line1/temperature',
    connectionFields: [
      { key: 'host', label: 'Broker 地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 1883 },
    ],
  },
  {
    type: 'coap',
    name: 'CoAP',
    category: 'IoT',
    description: 'CoAP 客户端，UDP CON 请求，GET 采集 / PUT 写入',
    supportedDataTypes: ['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'],
    defaultByteOrders: ['ABCD'],
    addressFormat: '资源路径',
    addressExample: '/sensors/temperature',
    connectionFields: [
      { key: 'host', label: '服务器地址', type: 'text', required: true },
      { key: 'port', label: '端口', type: 'number', required: true, defaultValue: 5683 },
    ],
  },
]

export const dataTypeLabels: Record<string, string> = {
  bool: '布尔',
  // 8 位
  int8: '8位有符号整数 (SINT)',
  uint8: '8位无符号整数 (USINT)',
  // 16 位
  int16: '16位有符号整数 (INT)',
  uint16: '16位无符号整数 (UINT)',
  // 32 位
  int32: '32位有符号整数 (DINT)',
  uint32: '32位无符号整数 (UDINT)',
  // 64 位
  int64: '64位有符号整数 (LINT)',
  uint64: '64位无符号整数 (ULINT)',
  // 浮点
  float32: '32位浮点数 (REAL)',
  float64: '64位浮点数 (LREAL)',
  // 字符串
  string: 'STRING（字符串）',
  short_string: 'SHORT_STRING（短字符串）',
  // S7 专用
  byte: '字节 (BYTE)',
  word: '字 (WORD)',
  dword: '双字 (DWORD)',
}

export const byteOrderLabels: Record<string, string> = {
  AB: '大端',
  BA: '小端',
  ABCD: '大端',
  CDAB: '字交换',
  BADC: '字节交换',
  DCBA: '小端',
}

export const combinedDataTypes = [
  // 布尔
  { value: 'bool:AB', label: '布尔', dataType: 'bool', byteOrder: 'AB' },

  // 8 位（ControlLogix SINT / USINT）
  { value: 'int8:AB',   label: '8位有符号整数 (SINT)',   dataType: 'int8',   byteOrder: 'AB' },
  { value: 'uint8:AB',  label: '8位无符号整数 (USINT)',  dataType: 'uint8',  byteOrder: 'AB' },

  // 16 位
  { value: 'int16:AB',  label: '16位有符号整数 (INT, 大端)',   dataType: 'int16',  byteOrder: 'AB' },
  { value: 'int16:BA',  label: '16位有符号整数 (INT, 小端)',   dataType: 'int16',  byteOrder: 'BA' },
  { value: 'uint16:AB', label: '16位无符号整数 (UINT, 大端)',  dataType: 'uint16', byteOrder: 'AB' },
  { value: 'uint16:BA', label: '16位无符号整数 (UINT, 小端)',  dataType: 'uint16', byteOrder: 'BA' },

  // 32 位（ControlLogix DINT / UDINT / REAL）
  { value: 'int32:ABCD',  label: '32位有符号整数 (DINT, 大端)',     dataType: 'int32',  byteOrder: 'ABCD' },
  { value: 'int32:CDAB',  label: '32位有符号整数 (DINT, 字交换)',   dataType: 'int32',  byteOrder: 'CDAB' },
  { value: 'int32:BADC',  label: '32位有符号整数 (DINT, 字节交换)', dataType: 'int32',  byteOrder: 'BADC' },
  { value: 'int32:DCBA',  label: '32位有符号整数 (DINT, 小端)',     dataType: 'int32',  byteOrder: 'DCBA' },
  { value: 'uint32:ABCD', label: '32位无符号整数 (UDINT, 大端)',    dataType: 'uint32', byteOrder: 'ABCD' },
  { value: 'uint32:CDAB', label: '32位无符号整数 (UDINT, 字交换)',  dataType: 'uint32', byteOrder: 'CDAB' },
  { value: 'uint32:BADC', label: '32位无符号整数 (UDINT, 字节交换)',dataType: 'uint32', byteOrder: 'BADC' },
  { value: 'uint32:DCBA', label: '32位无符号整数 (UDINT, 小端)',    dataType: 'uint32', byteOrder: 'DCBA' },

  // 64 位（ControlLogix LINT / ULINT / LREAL）
  { value: 'int64:ABCD',  label: '64位有符号整数 (LINT, 大端)',   dataType: 'int64',  byteOrder: 'ABCD' },
  { value: 'int64:DCBA',  label: '64位有符号整数 (LINT, 小端)',   dataType: 'int64',  byteOrder: 'DCBA' },
  { value: 'uint64:ABCD', label: '64位无符号整数 (ULINT, 大端)',  dataType: 'uint64', byteOrder: 'ABCD' },
  { value: 'uint64:DCBA', label: '64位无符号整数 (ULINT, 小端)',  dataType: 'uint64', byteOrder: 'DCBA' },

  // 浮点
  { value: 'float32:ABCD', label: '32位浮点数 (REAL, 大端)',     dataType: 'float32', byteOrder: 'ABCD' },
  { value: 'float32:CDAB', label: '32位浮点数 (REAL, 字交换)',   dataType: 'float32', byteOrder: 'CDAB' },
  { value: 'float32:BADC', label: '32位浮点数 (REAL, 字节交换)', dataType: 'float32', byteOrder: 'BADC' },
  { value: 'float32:DCBA', label: '32位浮点数 (REAL, 小端)',     dataType: 'float32', byteOrder: 'DCBA' },
  { value: 'float64:ABCD', label: '64位浮点数 (LREAL, 大端)',    dataType: 'float64', byteOrder: 'ABCD' },
  { value: 'float64:DCBA', label: '64位浮点数 (LREAL, 小端)',    dataType: 'float64', byteOrder: 'DCBA' },

  // 字符串
  { value: 'string:ABCD',       label: 'STRING（字符串）',         dataType: 'string',       byteOrder: 'ABCD' },
  { value: 'short_string:ABCD', label: 'SHORT_STRING（短字符串）', dataType: 'short_string', byteOrder: 'ABCD' },
] as const

export function toCombinedValue(dataType?: string, byteOrder?: string) {
  const exact = combinedDataTypes.find((item) => item.dataType === dataType && item.byteOrder === byteOrder)
  if (exact) return exact.value
  const byType = combinedDataTypes.find((item) => item.dataType === dataType)
  return byType?.value ?? 'int16:AB'
}

export function parseCombinedValue(value?: string) {
  const found = combinedDataTypes.find((item) => item.value === value)
  if (found) return { dataType: found.dataType, byteOrder: found.byteOrder, label: found.label }
  const [dataType, byteOrder] = String(value || 'int16:AB').split(':')
  return { dataType: dataType || 'int16', byteOrder: byteOrder || 'AB', label: dataTypeLabels[dataType || 'int16'] ?? value }
}

export function combinedDataTypeLabel(dataType?: string, byteOrder?: string) {
  return parseCombinedValue(toCombinedValue(dataType, byteOrder)).label
}

export const getProtocolConfig = (type: string) =>
  protocolConfigs.find((p) => p.type === type)

export const isModbusProtocol = (type?: string) =>
  type === 'modbus-tcp' || type === 'modbus-rtu' || type === 'modbus-ascii'

export function getFunctionCodeLabel(type?: string) {
  return getProtocolConfig(type ?? '')?.functionCodeLabel ?? '功能码'
}

export function formatFunctionCode(code?: string, protocol?: string) {
  if (!code) return '-'
  const cfg = protocol ? getProtocolConfig(protocol) : undefined
  const opt = (cfg?.functionCodes ?? modbusFunctionCodes).find((f) => f.value === code)
  return opt?.label ?? code
}


/**
 * 按协议过滤可用的 combinedDataTypes。
 * - 协议未声明 supportedDataTypes 时，返回全量列表
 * - 协议声明了 supportedDataTypes 时，只返回匹配 dataType 的条目
 */
export function getCombinedDataTypesFor(protocol?: string) {
  const cfg = protocol ? getProtocolConfig(protocol) : undefined
  if (!cfg) return combinedDataTypes

  const allowed = new Set(cfg.supportedDataTypes ?? [])
  if (allowed.size === 0) return combinedDataTypes

  return combinedDataTypes.filter((item) => allowed.has(item.dataType))
}