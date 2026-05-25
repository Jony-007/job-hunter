"""
notifier.py — Desktop notification dispatcher for JobHunter.

Primary:   plyer desktop notification (Windows toast / Linux libnotify)
Fallback:  plain console + log output if plyer is unavailable or crashes.
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def notify_new_jobs(jobs: list[dict]) -> None:
    """Send a desktop notification summarising *jobs*.

    Shows the first 3 job titles with their companies.  Falls back to a
    console printout if plyer isn't working (headless CI, missing DBus, etc.).
    """
    if not jobs:
        return

    count = len(jobs)
    title = f"JobHunter — {count} New Job{'s' if count > 1 else ''}"

    # Build the message body — first 3 jobs max
    lines: list[str] = []
    for job in jobs[:3]:
        job_title = job.get("title", "Unknown")
        company = job.get("company", "Unknown")
        lines.append(f"• {job_title} at {company}")
    if count > 3:
        lines.append(f"  … and {count - 3} more")
    message = "\n".join(lines)

    # ── Primary: plyer desktop notification ──
    try:
        from plyer import notification  # type: ignore[import-untyped]

        notification.notify(
            title=title,
            message=message,
            timeout=10,
            app_name="JobHunter",
        )
        logger.info("Desktop notification sent for %d new job(s)", count)
        return  # success
    except ImportError:
        logger.warning("plyer is not installed — falling back to console notification")
    except Exception:
        logger.warning(
            "plyer notification failed — falling back to console notification",
            exc_info=True,
        )

    # ── Fallback: console + log ──
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    fallback = f"\n{'='*50}\n[{timestamp}] {title}\n{message}\n{'='*50}"
    print(fallback)
    logger.info("Console notification (fallback):\n%s", fallback)
