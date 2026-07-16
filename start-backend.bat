@echo off
chcp 65001 >nul
title 项目信息一键提取 - 后端服务

:: 尝试把常见 Node.js 安装路径加入 PATH，避免双击时找不到 npm/node
set "NODE_DIR=%USERPROFILE%\AppData\Local\nodejs\node-v22.23.1-win-x64"
if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
)
set "PATH=%USERPROFILE%\AppData\Local\nodejs;%PATH%"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "PATH=C:\Program Files (x86)\nodejs;%PATH%"

:: 检查 node 和 npm 是否可用
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node.exe，请确保已安装 Node.js 并将其添加到系统 PATH。
  echo 安装地址: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请确保 Node.js 安装完整。
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0\backend"

if not exist ".env" (
  echo 未找到 .env 文件，使用 .env.example 作为默认配置。
  copy /Y ".env.example" ".env" >nul
  echo.
  echo 提示：如果你的 MySQL 需要密码，请编辑 backend\.env 填写 DB_PASSWORD；
  echo       或者通过网页 http://localhost:3000/settings.html 保存数据库配置。
  echo.
)

echo 正在启动后端服务...
echo 浏览器访问: http://localhost:3000/
echo 日志文件: %CD%\server.log
echo 请保持此窗口打开，按 Ctrl+C 可停止服务
echo.

:: 清空旧日志并启动
> server.log (
  echo [%date% %time%] 启动后端服务...
)

npm start >> server.log 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% neq 0 (
  echo [错误] 服务启动失败，退出码: %EXIT_CODE%
  echo.
  echo ---- 最近日志 ----
  type server.log
  echo.
  echo 完整日志: %CD%\server.log
) else (
  echo 服务已停止。
  echo 日志: %CD%\server.log
)
echo.
pause
