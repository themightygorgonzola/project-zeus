@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-save.ps1" %*
exit /b %errorlevel%
