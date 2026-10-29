@echo off
chcp 65001 >nul
title PLC 采集服务(5100) 一键启动
cd /d "%~dp0"

echo ========================================
echo   PLC 采集服务（生产模式，仅后端）
echo   地址: http://127.0.0.1:5100
echo   端口: PORT=5100（环境变量优先）
echo ========================================
echo.

if not exist node_modules (
    echo [首次运行] 正在安装依赖，请稍候...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

if not exist dist (
    echo [提示] 未发现 dist，正在构建前端...
    call npx vite build
)

set NODE_OPTIONS=--experimental-sqlite
set PORT=5100
call npx tsx server/src/index.ts
pause
