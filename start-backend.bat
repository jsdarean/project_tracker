@echo off
chcp 65001 >nul
title 项目信息一键提取 - 后端服务
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
echo 按 Ctrl+C 可停止服务
echo.
npm start

if errorlevel 1 (
  echo.
  echo 启动失败，请检查上方错误信息。
  pause
)
