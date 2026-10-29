import type { Tag } from '../types'
import { parseCombinedValue, toCombinedValue } from './protocolConfigs'

export const tagCsvHeaders = [
  'name',
  'deviceName',
  'functionCode',
  'address',
  'dataType',
  'byteOrder',
  'accessMode',
  'scale',
  'offset',
  'unit',
  'enabled',
] as const

function csvEscape(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function tagsToCsv(tags: Array<Partial<Tag>>) {
  const lines = [
    tagCsvHeaders.join(','),
    ...tags.map((tag) => [
      tag.name ?? '',
      tag.deviceName ?? '',
      tag.functionCode ?? '',
      tag.address ?? '',
      tag.dataType ?? '',
      tag.byteOrder ?? '',
      tag.accessMode ?? '',
      tag.scale ?? '',
      tag.offset ?? '',
      tag.unit ?? '',
      tag.enabled === false ? '0' : '1',
    ].map(csvEscape).join(',')),
  ]
  return `\uFEFF${lines.join('\n')}`
}

function splitCsvLine(line: string) {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current.trim())
  return out
}

function resolveDataType(dataTypeRaw: string, byteOrderRaw: string) {
  if (!dataTypeRaw) return parseCombinedValue(toCombinedValue('int16', byteOrderRaw || 'AB'))
  if (dataTypeRaw.includes(':')) return parseCombinedValue(dataTypeRaw)
  const pretty = [
    { test: /布尔/, value: 'bool:AB' },
    { test: /16位有符号/, value: 'int16:AB' },
    { test: /16位无符号/, value: 'uint16:AB' },
    { test: /32位有符号.*小端/, value: 'int32:DCBA' },
    { test: /32位有符号/, value: 'int32:ABCD' },
    { test: /32位无符号.*小端/, value: 'uint32:DCBA' },
    { test: /32位无符号/, value: 'uint32:ABCD' },
    { test: /64位有符号.*小端/, value: 'int64:DCBA' },
    { test: /64位有符号/, value: 'int64:ABCD' },
    { test: /64位无符号.*小端/, value: 'uint64:DCBA' },
    { test: /64位无符号/, value: 'uint64:ABCD' },
    { test: /32位浮点.*小端/, value: 'float32:DCBA' },
    { test: /32位浮点/, value: 'float32:ABCD' },
    { test: /64位浮点.*小端/, value: 'float64:DCBA' },
    { test: /64位浮点/, value: 'float64:ABCD' },
    { test: /字符串/, value: 'string:ABCD' },
  ]
  const hit = pretty.find((item) => item.test.test(dataTypeRaw))
  if (hit) return parseCombinedValue(hit.value)
  return parseCombinedValue(toCombinedValue(dataTypeRaw, byteOrderRaw || 'AB'))
}

export function parseTagCsv(text: string, devices: { id: string; name: string }[]) {
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('CSV 没有数据行')
  const headers = splitCsvLine(lines[0]).map((item) => item.replace(/^\uFEFF/, ''))
  const indexOf = (keys: string[]) => headers.findIndex((item) => keys.includes(item.toLowerCase()))
  const col = {
    name: indexOf(['name', '名称', '寄存器名称']),
    deviceName: indexOf(['devicename', '设备', '所属设备']),
    functionCode: indexOf(['functioncode', '功能码', '寄存器类型']),
    address: indexOf(['address', '地址', '寄存器地址']),
    dataType: indexOf(['datatype', '数据类型']),
    byteOrder: indexOf(['byteorder', '字节序']),
    accessMode: indexOf(['accessmode', '读写', '读写属性']),
    scale: indexOf(['scale', '系数']),
    offset: indexOf(['offset', '偏移']),
    unit: indexOf(['unit', '单位']),
    enabled: indexOf(['enabled', '启用']),
  }
  if (col.name < 0 || col.deviceName < 0 || col.address < 0) {
    throw new Error('CSV 表头必须包含 name/deviceName/address（或 名称/设备/地址）')
  }

  const tags: Partial<Tag>[] = []
  const errors: string[] = []
  lines.slice(1).forEach((line, idx) => {
    const cells = splitCsvLine(line)
    const name = cells[col.name] || ''
    const deviceName = cells[col.deviceName] || ''
    const address = cells[col.address] || ''
    if (!name || !deviceName || !address) {
      errors.push(`第 ${idx + 2} 行缺少名称、设备或地址`)
      return
    }
    const device = devices.find((item) => item.name === deviceName || item.id === deviceName)
    if (!device) {
      errors.push(`第 ${idx + 2} 行找不到设备: ${deviceName}`)
      return
    }
    const combo = resolveDataType(
      col.dataType >= 0 ? cells[col.dataType] : '',
      col.byteOrder >= 0 ? cells[col.byteOrder] : '',
    )
    const access = (col.accessMode >= 0 ? cells[col.accessMode] : 'read') || 'read'
    const accessMode = access.includes('读写') || access === 'readwrite'
      ? 'readwrite'
      : access.includes('写') || access === 'write'
        ? 'write'
        : 'read'
    tags.push({
      name,
      deviceId: device.id,
      deviceName: device.name,
      functionCode: col.functionCode >= 0 ? (cells[col.functionCode] || '03') : '03',
      address,
      dataType: combo.dataType as Tag['dataType'],
      byteOrder: combo.byteOrder as Tag['byteOrder'],
      accessMode,
      scale: Number(col.scale >= 0 ? cells[col.scale] : 1) || 1,
      offset: Number(col.offset >= 0 ? cells[col.offset] : 0) || 0,
      unit: col.unit >= 0 ? cells[col.unit] : '',
      enabled: col.enabled < 0 ? true : !['0', 'false', '否', 'n'].includes((cells[col.enabled] || '1').toLowerCase()),
    })
  })
  return { tags, errors }
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function tagTemplateCsv() {
  return tagsToCsv([
    {
      name: '温度',
      deviceName: 'test',
      functionCode: '03',
      address: '40001',
      dataType: 'int16',
      byteOrder: 'AB',
      accessMode: 'read',
      scale: 1,
      offset: 0,
      unit: '℃',
      enabled: true,
    },
  ])
}
