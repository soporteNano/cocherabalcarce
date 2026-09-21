@echo off
cd /d "%~dp0"
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:3210'"
node src\server.js
pause
