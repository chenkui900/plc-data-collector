import type { ByteOrder, DataType } from '../types.ts'

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时 (${ms}ms)`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function registerCount(dataType: DataType) {
  switch (dataType) {
    case 'bool':
    case 'byte':
    case 'int16':
    case 'uint16':
    case 'word':
      return 1
    case 'int32':
    case 'uint32':
    case 'float32':
    case 'dword':
      return 2
    case 'int64':
    case 'uint64':
    case 'float64':
      return 4
    case 'string':
      return 8
    default:
      return 1
  }
}

export function applyOrder(buf: Buffer, order: ByteOrder) {
  if (buf.length < 2) return buf
  if (buf.length === 2) {
    if (order === 'BA' || order === 'DCBA' || order === 'BADC') {
      return Buffer.from([buf[1], buf[0]])
    }
    return buf
  }
  const out = Buffer.from(buf)
  for (let i = 0; i + 3 < out.length; i += 4) {
    const a = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    let o = a
    if (order === 'CDAB') o = [a[2], a[3], a[0], a[1]]
    else if (order === 'BADC') o = [a[1], a[0], a[3], a[2]]
    else if (order === 'DCBA') o = [a[3], a[2], a[1], a[0]]
    else if (order === 'BA') o = [a[1], a[0], a[3], a[2]]
    out[i] = o[0]
    out[i + 1] = o[1]
    out[i + 2] = o[2]
    out[i + 3] = o[3]
  }
  return out
}

export function wordsToBuffer(words: number[]) {
  const buf = Buffer.alloc(words.length * 2)
  words.forEach((value, index) => buf.writeUInt16LE(value & 0xffff, index * 2))
  return buf
}

export function bufferToWords(buf: Buffer) {
  const words: number[] = []
  for (let i = 0; i < buf.length; i += 2) {
    words.push(buf.readUInt16LE(i))
  }
  return words
}

/**
 * 按数据类型解码字节
 * @param littleEndian 协议字节序：Modbus/S7 为大端(false)，三菱 MC 为小端(true)
 */
export function decodeBytes(buf: Buffer, dataType: DataType, order: ByteOrder, littleEndian = false) {
  const ordered = applyOrder(buf, order)
  const le = littleEndian
  switch (dataType) {
    case 'bool':
      return le ? ordered.readUInt16LE(0) !== 0 : ordered.readUInt16BE(0) !== 0
    case 'int16':
      return le ? ordered.readInt16LE(0) : ordered.readInt16BE(0)
    case 'uint16':
    case 'word':
    case 'byte':
      return le ? ordered.readUInt16LE(0) : ordered.readUInt16BE(0)
    case 'int32':
      return le ? ordered.readInt32LE(0) : ordered.readInt32BE(0)
    case 'uint32':
    case 'dword':
      return le ? ordered.readUInt32LE(0) : ordered.readUInt32BE(0)
    case 'float32':
      return le ? ordered.readFloatLE(0) : ordered.readFloatBE(0)
    case 'int64':
      return le ? Number(ordered.readBigInt64LE(0)) : Number(ordered.readBigInt64BE(0))
    case 'uint64':
      return le ? Number(ordered.readBigUInt64LE(0)) : Number(ordered.readBigUInt64BE(0))
    case 'float64':
      return le ? ordered.readDoubleLE(0) : ordered.readDoubleBE(0)
    case 'string':
      return ordered.toString('utf8').replace(/\0+$/g, '')
    default:
      return le ? ordered.readUInt16LE(0) : ordered.readUInt16BE(0)
  }
}

/**
 * 按数据类型编码为字节（返回未经字节序重排的原始大端/小端缓冲）
 */
export function encodeBytes(
  value: string | number | boolean,
  dataType: DataType,
  order: ByteOrder,
  scale = 1,
  offset = 0,
  littleEndian = false,
) {
  const len = registerCount(dataType)
  const buf = Buffer.alloc(len * 2)
  let numeric = typeof value === 'number' ? value : Number(value)
  if (dataType !== 'bool' && dataType !== 'string' && Number.isFinite(numeric)) {
    numeric = (numeric - (offset || 0)) / (scale || 1)
  }
  const le = littleEndian
  switch (dataType) {
    case 'bool': {
      const flag = value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0
      if (le) buf.writeUInt16LE(flag, 0)
      else buf.writeUInt16BE(flag, 0)
      break
    }
    case 'int16':
      if (le) buf.writeInt16LE(Math.trunc(numeric), 0)
      else buf.writeInt16BE(Math.trunc(numeric), 0)
      break
    case 'uint16':
    case 'word':
    case 'byte':
      if (le) buf.writeUInt16LE(Math.trunc(numeric) & 0xffff, 0)
      else buf.writeUInt16BE(Math.trunc(numeric) & 0xffff, 0)
      break
    case 'int32':
      if (le) buf.writeInt32LE(Math.trunc(numeric), 0)
      else buf.writeInt32BE(Math.trunc(numeric), 0)
      break
    case 'uint32':
    case 'dword':
      if (le) buf.writeUInt32LE(Math.trunc(numeric) >>> 0, 0)
      else buf.writeUInt32BE(Math.trunc(numeric) >>> 0, 0)
      break
    case 'float32':
      if (le) buf.writeFloatLE(numeric, 0)
      else buf.writeFloatBE(numeric, 0)
      break
    case 'int64':
      if (le) buf.writeBigInt64LE(BigInt(Math.trunc(numeric)), 0)
      else buf.writeBigInt64BE(BigInt(Math.trunc(numeric)), 0)
      break
    case 'uint64':
      if (le) buf.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(numeric))), 0)
      else buf.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(numeric))), 0)
      break
    case 'float64':
      if (le) buf.writeDoubleLE(numeric, 0)
      else buf.writeDoubleBE(numeric, 0)
      break
    case 'string':
      Buffer.from(String(value), 'utf8').copy(buf)
      break
    default:
      if (le) buf.writeUInt16LE(Math.trunc(numeric) & 0xffff, 0)
      else buf.writeUInt16BE(Math.trunc(numeric) & 0xffff, 0)
  }
  return applyOrder(buf, order)
}

export function applyScale(value: number, scale = 1, offset = 0) {
  const next = value * (scale || 1) + (offset || 0)
  return Number.isInteger(next) ? next : Math.round(next * 1000) / 1000
}

export function toBoolean(value: string | number | boolean) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return value === 'true' || value === '1' || value.toLowerCase() === 'on'
}

export function toNumber(value: string | number | boolean) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
