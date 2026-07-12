@echo off
cd /d "%~dp0"
start "Pokemon Tracker Server" cmd /k npx serve -l 5173 .
timeout /t 2 /nobreak >nul
start "" http://localhost:5173
