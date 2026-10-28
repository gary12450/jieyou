@echo off
title jieyou local test server
cd /d "%~dp0"
netstat -ano | findstr ":8140 " | findstr LISTENING >nul
if not errorlevel 1 (
    start "" http://localhost:8140/
    exit /b
)
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8140/"
node dev\server.js
pause
