import type { Device, LogEntry, Tag } from '../types'
import type { PushChannel } from '../types/push'
import type { AppSettings, Overview } from './types'

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 8000
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('请求超时，设备无响应')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || '请求失败')
  }
  return data as T
}

export const api = {
  overview: () => request<Overview>('/overview'),
  devices: {
    list: () => request<Device[]>('/devices'),
    create: (body: Partial<Device>) => request<Device>('/devices', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Device>) => request<Device>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (id: string, body: Partial<Device>) => request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean }>(`/devices/${id}`, { method: 'DELETE' }),
    test: (id: string) => request<{ ok: boolean; message: string }>(`/devices/${id}/test`, { method: 'POST', timeoutMs: 8000 }),
  },
  tags: {
    list: () => request<Tag[]>('/tags'),
    create: (body: Partial<Tag>) => request<Tag>('/tags', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Tag>) => request<Tag>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (id: string, body: Partial<Tag>) => request<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    write: (id: string, value: string | number | boolean) =>
      request<Tag>(`/tags/${id}/write`, { method: 'POST', body: JSON.stringify({ value }) }),
    import: (tags: Partial<Tag>[]) =>
      request<{ created: number; failed: number; errors: string[]; tags: Tag[] }>('/tags/import', { method: 'POST', body: JSON.stringify({ tags }), timeoutMs: 20000 }),
    remove: (id: string) => request<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  },
  push: {
    list: () => request<PushChannel[]>('/push'),
    create: (body: Partial<PushChannel>) => request<PushChannel>('/push', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<PushChannel>) => request<PushChannel>(`/push/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (id: string, body: Partial<PushChannel>) => request<PushChannel>(`/push/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean }>(`/push/${id}`, { method: 'DELETE' }),
  },
  logs: {
    list: () => request<LogEntry[]>('/logs?limit=500'),
    clear: () => request<{ ok: boolean }>('/logs', { method: 'DELETE' }),
  },
  settings: {
    get: () => request<AppSettings>('/settings'),
    save: (body: AppSettings) => request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  },
}
