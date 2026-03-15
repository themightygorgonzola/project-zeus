@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-dev.ps1" %*
exit /b %errorlevel%
