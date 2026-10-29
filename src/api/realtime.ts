import { useEffect, useRef } from 'react'
import type { RealtimeMessage } from './types'

export function useRealtime(onMessage: (message: RealtimeMessage) => void) {
  const handler = useRef(onMessage)
  handler.current = onMessage

  useEffect(() => {
    let closed = false
    let socket: WebSocket | null = null
    let retry: number | undefined
    let heartbeat: number | undefined

    const connect = () => {
      if (closed) return
      
      // 判断是否是本地开发环境 (Vite 默认端口 5173)
      // 如果是，直接连接后端的 8080 端口，绕过 Vite 代理，消除代理层报错
      const isDev = window.location.port === '5173'
      const wsUrl = isDev 
        ? 'ws://127.0.0.1:8080/ws' 
        : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 25000)
      }

      socket.onmessage = (event) => {
        try {
          handler.current(JSON.parse(event.data) as RealtimeMessage)
        } catch {
          /* ignore */
        }
      }

      socket.onclose = () => {
        if (heartbeat) {
          window.clearInterval(heartbeat)
          heartbeat = undefined
        }
        if (!closed) retry = window.setTimeout(connect, 2000)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 屏幕亮起时，立刻检查连接并重连
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          if (retry) window.clearTimeout(retry)
          connect()
        }
      } else {
        // 屏幕黑屏/切到后台时，主动断开，防止浏览器的节流机制导致假死
        if (socket) {
          socket.close()
          socket = null
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    connect()

    return () => {
      closed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (retry) window.clearTimeout(retry)
      if (heartbeat) window.clearInterval(heartbeat)
      socket?.close()
    }
  }, [])
}