import { EventEmitter } from 'node:events'
import type { WebSocketServer, WebSocket } from 'ws'
import type { RealtimeMessage } from './types.ts'
import { getStore } from './store.ts'

const bus = new EventEmitter()
bus.setMaxListeners(50)

const sockets = new Set<WebSocket>()

export function attachWss(wss: WebSocketServer) {
  wss.on('connection', (socket) => {
    sockets.add(socket)
    socket.send(JSON.stringify({ type: 'hello', data: getStore() } satisfies RealtimeMessage))

    // 收到客户端的 ping 就回 pong，保持连接活跃
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        /* 非 JSON 消息忽略 */
      }
    })

    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
  })
}

export function broadcast(message: RealtimeMessage) {
  const raw = JSON.stringify(message)
  for (const socket of sockets) {
    if (socket.readyState === 1) socket.send(raw)
  }
  bus.emit('message', message)
}

export function onBroadcast(handler: (message: RealtimeMessage) => void) {
  bus.on('message', handler)
}
