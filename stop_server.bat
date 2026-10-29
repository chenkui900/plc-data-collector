@echo off
chcp 65001 >nul
title PLC 采集服务 停止

echo.
echo ========================================
echo   停止 PLC 采集服务（仅本项目，按端口 5100）
echo ========================================
echo.

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5100 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess | Select-Object -Unique | ForEach-Object { Write-Output ('已停止进程 ' + $_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } else { Write-Output '端口 5100 无监听，PLC 采集服务未在运行' }"

echo.
echo 说明：只停止占用 5100 端口的 PLC 采集进程，
echo       不影响 DB_Sync (5000) 和 Y2A-Auto (5500)。
echo.
echo 注意：若前端开发模式（npm run dev）也在跑，它占用 8080/5173，
echo       本脚本不会停它；如需停止请直接关闭对应窗口。
echo.
pause
