@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-check.ps1" %*
exit /b %errorlevel%
