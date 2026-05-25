"""
stealth.py — Anti-detection & rate-limiting module for JobHunter.

Provides:
  • get_stealth_context()  — launch a headless Chromium with stealth patches
  • human_delay / human_mouse_move / human_scroll — behavioural camouflage
  • check_captcha()        — detect CAPTCHA / bot walls and nuke cookies
  • RateLimiter            — per-source hourly request cap
"""

import asyncio
import json
import logging
import os
import random
import time
from collections import deque
from typing import Tuple

from playwright.async_api import async_playwright, Playwright, Browser, BrowserContext, Page
from playwright_stealth import stealth_async

logger = logging.getLogger(__name__)

COOKIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.json")


# ──────────────────────────────────────────────
# Stealth browser bootstrap
# ──────────────────────────────────────────────

async def get_stealth_context(
    playwright: Playwright,
) -> Tuple[Browser, BrowserContext, Page]:
    """Launch Chromium with anti-detection flags, apply stealth, load cookies.

    Returns (browser, context, page).
    """
    browser = await playwright.chromium.launch(
        headless=False,
        channel="chrome",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--window-size=1920,1080",
            "--disable-gpu",
            "--mute-audio",
        ],
    )

    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1920, "height": 1080},
        locale="en-CA",
        timezone_id="America/Regina",
        color_scheme="light",
        device_scale_factor=1,
        extra_http_headers={
            "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
            "Sec-Ch-Ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }
    )

    # ── Load persisted cookies ──
    if os.path.exists(COOKIES_PATH):
        try:
            with open(COOKIES_PATH, "r", encoding="utf-8") as fh:
                state = json.load(fh)
            cookies = state.get("cookies", state) if isinstance(state, dict) else state
            if isinstance(cookies, list) and cookies:
                await context.add_cookies(cookies)
                logger.info("Loaded %d cookies from %s", len(cookies), COOKIES_PATH)
        except Exception:
            logger.warning("Failed to load cookies, starting fresh", exc_info=True)

    page = await context.new_page()

    # ── Apply stealth patches BEFORE any navigation ──
    # await stealth_async(page)

    return browser, context, page


# ──────────────────────────────────────────────
# Human-like behaviour helpers
# ──────────────────────────────────────────────

async def human_delay() -> None:
    """Sleep for a random human-like interval (2 – 8 s)."""
    delay = random.uniform(2, 8)
    await asyncio.sleep(delay)


async def human_mouse_move(page: Page) -> None:
    """Move the mouse to a random viewport position."""
    try:
        x = random.randint(100, 800)
        y = random.randint(100, 600)
        await page.mouse.move(x, y)
    except Exception:
        pass  # non-critical


async def human_scroll(page: Page) -> None:
    """Scroll down by a random amount."""
    try:
        await page.evaluate("window.scrollBy(0, Math.random() * 500 + 200)")
    except Exception:
        pass  # non-critical


# ──────────────────────────────────────────────
# CAPTCHA detection
# ──────────────────────────────────────────────

CAPTCHA_SIGNALS = ("captcha", "robot", "unusual traffic", "verify", "just a moment", "cloudflare", "attention required")


async def check_captcha(page: Page, source: str) -> bool:
    """Return True if the current page looks like a CAPTCHA / bot challenge.

    If a wall is detected, it waits up to 45 seconds to let the user manually click the
    Cloudflare checkbox or solve the captcha on screen. Returns False if solved.
    """
    try:
        title = (await page.title()).lower()
    except Exception:
        title = ""

    url_lower = page.url.lower()

    detected = any(signal in title or signal in url_lower for signal in CAPTCHA_SIGNALS)

    if detected:
        logger.warning(
            "CAPTCHA / Cloudflare wall detected on %s (title=%r, url=%s)",
            source,
            title,
            page.url,
        )
        logger.info(
            "[ACTION REQUIRED] Please click the Cloudflare checkbox or solve the CAPTCHA in the open browser window on your screen!"
        )
        
        # Poll for up to 45 seconds to see if the user resolves it
        for attempt in range(45):
            await asyncio.sleep(1.0)
            try:
                current_title = (await page.title()).lower()
                current_url = page.url.lower()
                
                # Check if captcha signals are gone
                still_blocked = any(signal in current_title or signal in current_url for signal in CAPTCHA_SIGNALS)
                if not still_blocked:
                    logger.info("[SUCCESS] CAPTCHA / Cloudflare check successfully resolved! Proceeding with scrape...")
                    return False
            except Exception:
                pass
        
        logger.error("[ERROR] CAPTCHA / Cloudflare solving timed out or failed.")

        # Nuke cookies to force a fresh session next time
        if os.path.exists(COOKIES_PATH):
            try:
                os.remove(COOKIES_PATH)
                logger.info("Deleted %s after CAPTCHA detection", COOKIES_PATH)
            except OSError:
                logger.warning("Could not delete cookies file", exc_info=True)

    return detected


# ──────────────────────────────────────────────
# Rate limiter
# ──────────────────────────────────────────────

# Max requests per source per rolling 1-hour window
_SOURCE_LIMITS: dict[str, int] = {
    "linkedin": 20,
    "indeed": 30,
    "glassdoor": 15,
}

RATE_WINDOW_SECONDS = 3600  # 1 hour


class RateLimiter:
    """In-memory, per-source, sliding-window rate limiter."""

    def __init__(self) -> None:
        # source (lowercase) → deque of timestamps
        self._requests: dict[str, deque] = {}

    def _prune(self, source: str) -> None:
        """Remove timestamps older than the window."""
        if source not in self._requests:
            return
        cutoff = time.monotonic() - RATE_WINDOW_SECONDS
        dq = self._requests[source]
        while dq and dq[0] < cutoff:
            dq.popleft()

    def can_request(self, source: str) -> bool:
        """Return True if *source* has capacity left in its rate window."""
        key = source.lower()
        self._prune(key)
        limit = _SOURCE_LIMITS.get(key, 30)  # default 30/hr
        current = len(self._requests.get(key, []))
        if current >= limit:
            logger.warning(
                "Rate limit reached for %s (%d/%d in the last hour)",
                source,
                current,
                limit,
            )
            return False
        return True

    def record_request(self, source: str) -> None:
        """Record a request timestamp for *source*."""
        key = source.lower()
        if key not in self._requests:
            self._requests[key] = deque()
        self._requests[key].append(time.monotonic())
