@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 游戏预览即将启动。浏览器打开 http://localhost:5173/
echo 请保持此窗口开启，结束时按 Ctrl+C。
call npm.cmd run dev
pause
