@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-ship.ps1" %*
exit /b %errorlevel%
