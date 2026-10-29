import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'

let psProcess: ChildProcessWithoutNullStreams | null = null

/**
 * 阻止 Windows 系统休眠
 * 原理：利用 PowerShell 调用底层 Win32 API SetThreadExecutionState
 * 只要这个 PowerShell 进程活着，系统就不会进入睡眠
 */
export function preventSystemSleep() {
  if (process.platform !== 'win32') return

  const psScript = `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PowerUtil { [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern uint SetThreadExecutionState(uint esFlags); }'
    [PowerUtil]::SetThreadExecutionState(0x80000000 -bor 0x00000001)
    while ($true) { Start-Sleep -Seconds 60 }
  `

  console.log('[System] 正在启动防休眠守护进程...')
  
  // 使用 spawn 在后台静默运行
  psProcess = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
    stdio: 'ignore',
    windowsHide: true
  })

  psProcess.on('error', (err) => {
    console.error('[System] 防休眠守护进程启动失败:', err)
  })
}

/**
 * 恢复系统休眠设置（在服务关闭时调用）
 */
export function allowSystemSleep() {
  if (psProcess) {
    console.log('[System] 正在停止防休眠守护进程...')
    psProcess.kill()
    psProcess = null
  }
}