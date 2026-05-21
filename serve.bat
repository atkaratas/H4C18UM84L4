@echo off
REM Local-only launcher for Windows (loopback bind).
set PORT=%1
if "%PORT%"=="" set PORT=8000
echo Open http://127.0.0.1:%PORT%/  (Ctrl+C to stop)
python -m http.server %PORT% --bind 127.0.0.1
