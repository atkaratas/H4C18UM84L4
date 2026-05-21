@echo off
REM Double-click launcher for Windows — runs serve.ps1 with execution policy bypass.
REM No installation required. PowerShell is preinstalled on all modern Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
