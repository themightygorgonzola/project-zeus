@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-status.ps1" %*
exit /b %errorlevel%
