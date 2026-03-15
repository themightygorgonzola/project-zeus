@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site-release.ps1" %*
exit /b %errorlevel%
