"""
watchdog.py — Background health monitor for the scraper process.

Designed to be imported and run as an asyncio task inside api.py, NOT as
a standalone process.

Public API:
    watchdog_loop()       — coroutine that runs forever (call via asyncio.create_task)
    get_watchdog_status() — returns the current health snapshot as a dict
"""

import asyncio
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCK_PATH = os.path.join(_BASE_DIR, "scraper.lock")
SCRAPER_SCRIPT = os.path.join(_BASE_DIR, "scraper.py")

CHECK_INTERVAL_SECONDS = 300        # 5 minutes
STALE_THRESHOLD_SECONDS = 35 * 60   # 35 minutes — scraper should touch lock every cycle
MAX_MEMORY_MB = 500

# ──────────────────────────────────────────────
# Internal state
# ──────────────────────────────────────────────

_status: dict = {
    "last_check": None,
    "scraper_running": False,
    "scraper_pid": None,
    "scraper_memory_mb": None,
    "restarts": 0,
    "status": "idle",
    "error": None,
}


def get_watchdog_status() -> dict:
    """Return a snapshot of the watchdog's last-known state."""
    return dict(_status)


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _read_pid() -> int | None:
    """Read the PID from the scraper lock file, or None."""
    try:
        with open(LOCK_PATH, "r", encoding="utf-8") as fh:
            raw = fh.read().strip()
        return int(raw)
    except (FileNotFoundError, ValueError, OSError):
        return None


def _is_process_alive(pid: int) -> bool:
    """Check if *pid* is still running using psutil (or os.kill fallback)."""
    try:
        import psutil
        return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
    except Exception:
        pass
    # Fallback: os-level probe (does not send a signal on Windows)
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError, PermissionError):
        return False


def _get_memory_mb(pid: int) -> float | None:
    """Return RSS in MB for *pid*, or None on failure."""
    try:
        import psutil
        proc = psutil.Process(pid)
        mem = proc.memory_info()
        return mem.rss / (1024 * 1024)
    except Exception:
        return None


def _kill_process(pid: int) -> None:
    """Terminate / kill *pid* as forcefully as needed."""
    try:
        import psutil
        proc = psutil.Process(pid)
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except psutil.TimeoutExpired:
            proc.kill()
        logger.info("Killed scraper process PID %d", pid)
    except Exception:
        # Fallback
        try:
            os.kill(pid, 9)
        except Exception:
            pass


def _remove_lock() -> None:
    """Delete the lock file if it exists."""
    try:
        if os.path.exists(LOCK_PATH):
            os.remove(LOCK_PATH)
            logger.info("Removed stale lock file %s", LOCK_PATH)
    except OSError:
        logger.warning("Could not remove lock file", exc_info=True)


def _start_scraper() -> int | None:
    """Start a new scraper subprocess and return its PID."""
    try:
        proc = subprocess.Popen(
            [sys.executable, SCRAPER_SCRIPT],
            cwd=_BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        logger.info("Started scraper subprocess PID %d", proc.pid)
        return proc.pid
    except Exception:
        logger.exception("Failed to start scraper subprocess")
        return None


# ──────────────────────────────────────────────
# Main loop
# ──────────────────────────────────────────────

async def watchdog_loop() -> None:
    """Run forever, checking scraper health every CHECK_INTERVAL_SECONDS."""
    logger.info("Watchdog started (interval=%ds)", CHECK_INTERVAL_SECONDS)

    while True:
        try:
            await _check_once()
        except Exception:
            logger.exception("Watchdog check failed")
            _status["error"] = "check raised exception"

        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


async def _check_once() -> None:
    """Single health-check iteration."""
    now_iso = datetime.now(timezone.utc).isoformat()
    _status["last_check"] = now_iso
    _status["error"] = None

    pid = _read_pid()
    _status["scraper_pid"] = pid

    if pid is None or not os.path.exists(LOCK_PATH):
        # No lock file → scraper is not running
        _status["scraper_running"] = False
        _status["scraper_memory_mb"] = None
        _status["status"] = "not_running"
        logger.debug("Watchdog: scraper not running (no lock file)")
        return

    # Lock file exists — is the process actually alive?
    alive = _is_process_alive(pid)

    if not alive:
        logger.warning("Watchdog: lock file exists but PID %d is dead", pid)
        _remove_lock()
        _status["scraper_running"] = False
        _status["status"] = "dead_cleaned"
        return

    _status["scraper_running"] = True

    # ── Staleness check ──
    try:
        lock_mtime = os.path.getmtime(LOCK_PATH)
        age_seconds = time.time() - lock_mtime
    except OSError:
        age_seconds = 0

    if age_seconds > STALE_THRESHOLD_SECONDS:
        logger.warning(
            "Watchdog: scraper frozen (lock file %.0f s old > %d s threshold). Restarting.",
            age_seconds,
            STALE_THRESHOLD_SECONDS,
        )
        _kill_process(pid)
        _remove_lock()
        await asyncio.sleep(2)  # brief pause before restart
        _start_scraper()
        _status["restarts"] += 1
        _status["status"] = "restarted_stale"
        return

    # ── Memory check ──
    mem_mb = _get_memory_mb(pid)
    _status["scraper_memory_mb"] = mem_mb

    if mem_mb is not None and mem_mb > MAX_MEMORY_MB:
        logger.warning(
            "Watchdog: scraper using %.1f MB (limit %d MB). Restarting.",
            mem_mb,
            MAX_MEMORY_MB,
        )
        _kill_process(pid)
        _remove_lock()
        await asyncio.sleep(2)
        _start_scraper()
        _status["restarts"] += 1
        _status["status"] = "restarted_memory"
        return

    _status["status"] = "healthy"
    logger.debug(
        "Watchdog: scraper healthy (PID %d, %.1f MB, age %.0f s)",
        pid,
        mem_mb or 0,
        age_seconds,
    )
