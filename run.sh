#!/usr/bin/env bash
set -e

echo ""
echo "  ============================================"
echo "  ⚡ JobHunter — Starting up..."
echo "  ============================================"
echo ""

# ─── Check Python ─────────────────────────────
if ! command -v python3 &> /dev/null; then
    echo "  ❌ ERROR: Python not found."
    echo "     Install Python 3.11+ from https://python.org"
    exit 1
fi
echo "  ✔ $(python3 --version) found"

# ─── Check Node ───────────────────────────────
if ! command -v node &> /dev/null; then
    echo "  ❌ ERROR: Node.js not found."
    echo "     Install Node.js 18+ from https://nodejs.org"
    exit 1
fi
echo "  ✔ Node.js $(node --version) found"

# ─── Get script directory ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Install Python dependencies ──────────────
echo ""
echo "  📦 Installing Python dependencies..."
pip3 install -r backend/requirements.txt -q 2>/dev/null || true

# ─── Install Playwright Chromium ──────────────
echo "  🌐 Installing Playwright Chromium browser..."
playwright install chromium 2>/dev/null || python3 -m playwright install chromium 2>/dev/null || true

# ─── Install frontend dependencies ────────────
echo "  📦 Installing frontend dependencies..."
cd frontend && npm install --silent 2>/dev/null && cd ..

# ─── Clean stale lock file ────────────────────
if [ -f backend/scraper.lock ]; then
    echo "  🧹 Cleaning stale scraper lock file..."
    rm -f backend/scraper.lock
fi

# ─── Trap to cleanup background processes ─────
PIDS=()
cleanup() {
    echo ""
    echo "  🛑 Shutting down JobHunter..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    rm -f backend/scraper.lock
    echo "  ✅ All processes stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo ""
echo "  ============================================"
echo "  🚀 Launching services..."
echo "  ============================================"
echo ""

# ─── Start API server (includes watchdog) ─────
echo "  🖥  Starting API server on localhost:8000..."
cd backend
python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 --log-level info &
PIDS+=($!)
cd ..

# ─── Wait for API to be ready ─────────────────
echo "  ⏳ Waiting for API to initialize..."
sleep 4

# ─── Start scraper ────────────────────────────
echo "  🔍 Starting job scraper..."
cd backend
python3 scraper.py &
PIDS+=($!)
cd ..

# ─── Start frontend ───────────────────────────
echo "  🎨 Starting frontend on localhost:5173..."
cd frontend
npm run dev &
PIDS+=($!)
cd ..

# ─── Wait then open browser ───────────────────
sleep 4
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5173
elif command -v open &> /dev/null; then
    open http://localhost:5173
fi

echo ""
echo "  ============================================"
echo "  ✅ JobHunter is running!"
echo "  ============================================"
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  API docs:  http://localhost:8000/docs"
echo "  Health:    http://localhost:8000/health"
echo ""
echo "  Press Ctrl+C to stop all services"
echo ""
echo "  ============================================"
echo ""

# ─── Wait for all background processes ────────
wait
