@echo off
chcp 65001 >nul
title PLC 采集 Web 界面(5173)

cd /d "%~dp0"

echo ========================================
echo   PLC 采集 Web 界面（前端）
echo   地址: http://127.0.0.1:5173
echo   API 代理指向 http://127.0.0.1:5100
echo   （请先用 start_server.bat 启动后端）
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

rem 前端 API 代理指向生产后端 5100
set API_PORT=5100
call npx vite --port 5173 --strictPort

pause
