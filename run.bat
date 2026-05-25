@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   ⚡ JobHunter — Starting up...
echo  ============================================
echo.

REM ─── Check Python ───────────────────────────
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  ❌ ERROR: Python not found.
    echo     Install Python 3.11+ from https://python.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do (
    echo  ✔ Python %%v found
)

REM ─── Check Node ─────────────────────────────
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  ❌ ERROR: Node.js not found.
    echo     Install Node.js 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node --version 2^>^&1') do (
    echo  ✔ Node.js %%v found
)

REM ─── Install Python dependencies ────────────
echo.
echo  📦 Installing Python dependencies...
pip install -r backend\requirements.txt -q 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo  ⚠ pip install had warnings, continuing...
)

REM ─── Install Playwright Chromium ────────────
echo  🌐 Installing Playwright Chromium browser...
playwright install chromium >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    python -m playwright install chromium >nul 2>&1
)

REM ─── Install frontend dependencies ──────────
echo  📦 Installing frontend dependencies...
cd frontend
call npm install --silent 2>nul
cd ..

REM ─── Clean stale lock file ──────────────────
IF EXIST backend\scraper.lock (
    echo  🧹 Cleaning stale scraper lock file...
    del backend\scraper.lock
)

echo.
echo  ============================================
echo   🚀 Launching services...
echo  ============================================
echo.

REM ─── Start API server (includes watchdog) ───
echo  🖥  Starting API server on localhost:8000...
start "JobHunter API" cmd /k "cd /d %~dp0backend && python -m uvicorn api:app --host 0.0.0.0 --port 8000 --log-level info"

REM ─── Wait for API to be ready ───────────────
echo  ⏳ Waiting for API to initialize...
timeout /t 4 /nobreak >nul

REM ─── Start scraper ──────────────────────────
echo  🔍 Starting job scraper...
start "JobHunter Scraper" cmd /k "cd /d %~dp0backend && python scraper.py"

REM ─── Start frontend ─────────────────────────
echo  🎨 Starting frontend on localhost:5173...
start "JobHunter Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM ─── Wait then open browser ─────────────────
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo  ============================================
echo   ✅ JobHunter is running!
echo  ============================================
echo.
echo   Frontend:  http://localhost:5173
echo   API docs:  http://localhost:8000/docs
echo   Health:    http://localhost:8000/health
echo.
echo   To stop: close all "JobHunter" windows
echo   Logs:    backend\scraper.log
echo.
echo  ============================================
echo.
pause
