import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 前端代理的后端地址：默认 8080（开发模式），可用环境变量 API_PORT 覆盖（如 5100）
const apiTarget = `http://127.0.0.1:${process.env.API_PORT || 8080}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
        // 👇 拦截并静默处理 WebSocket 的连接中断报错
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            const code = err?.code
            if (['ECONNABORTED', 'ECONNRESET', 'EPIPE'].includes(code)) {
              return // 静默忽略网络抖动/后端重启引发的断开
            }
            console.warn('[vite] ws proxy error:', code ?? err)
          })
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', () => {}) // 阻止底层 socket 错误冒泡
          })
        },
      },
    },
  },
})