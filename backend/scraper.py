"""
scraper.py — Main scraping engine for JobHunter.

Scrapes LinkedIn, Indeed (CA), and Glassdoor for IT / SysAdmin jobs in
Regina, Saskatchewan.  Runs in an infinite loop with a 30-minute interval,
checking for a manual trigger file every 10 seconds.

Usage:
    python scraper.py
"""

import asyncio
import atexit
import hashlib
import logging
import os
import random
import re
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse, urlunparse

# ──────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCK_PATH = os.path.join(_BASE_DIR, "scraper.lock")
LOG_PATH = os.path.join(_BASE_DIR, "scraper.log")
TRIGGER_PATH = os.path.join(_BASE_DIR, "scrape.trigger")
COOKIES_PATH = os.path.join(_BASE_DIR, "cookies.json")

# ──────────────────────────────────────────────
# Logging setup
# ──────────────────────────────────────────────

_log_formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s")

_file_handler = RotatingFileHandler(
    LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_file_handler.setFormatter(_log_formatter)

_console_handler = logging.StreamHandler(sys.stdout)
_console_handler.setFormatter(_log_formatter)

logging.basicConfig(level=logging.INFO, handlers=[_file_handler, _console_handler])
logger = logging.getLogger("scraper")

# ──────────────────────────────────────────────
# Search configuration
# ──────────────────────────────────────────────

SEARCH_QUERIES = [
    "IT Support",
    "SysAdmin",
    "Systems Administrator",
    "Cloud Administrator",
]

# ── Multi-location support ──
# Add or remove locations below. Each entry needs:
#   name:       display name
#   linkedin:   URL-encoded string for LinkedIn's location param
#   indeed:     URL-encoded string for Indeed's l= param
#   glassdoor:  Glassdoor location slug (city-province format in URL)
#   score_keywords: list of lowercase keywords that earn location bonus in scoring
#   score_primary: points for the primary city keyword match
LOCATIONS = [
    {
        "name": "Regina, SK",
        "linkedin": "Regina%2C+Saskatchewan%2C+Canada",
        "indeed": "Regina%2C+Saskatchewan",
        "glassdoor": "regina-saskatchewan-it-support-jobs-SRCH_IL.0,19_IS8219_KO20,30.htm",
        "score_keywords": ["regina", "saskatchewan"],
        "score_primary": 20,
    },
    {
        "name": "Saskatoon, SK",
        "linkedin": "Saskatoon%2C+Saskatchewan%2C+Canada",
        "indeed": "Saskatoon%2C+Saskatchewan",
        "glassdoor": "saskatoon-saskatchewan-it-support-jobs-SRCH_IL.0,23_IS8220_KO24,34.htm",
        "score_keywords": ["saskatoon", "saskatchewan"],
        "score_primary": 15,
    },
    {
        "name": "Winnipeg, MB",
        "linkedin": "Winnipeg%2C+Manitoba%2C+Canada",
        "indeed": "Winnipeg%2C+Manitoba",
        "glassdoor": "winnipeg-manitoba-it-support-jobs-SRCH_IL.0,18_IS4879_KO19,29.htm",
        "score_keywords": ["winnipeg", "manitoba"],
        "score_primary": 10,
    },
    {
        "name": "Remote Canada",
        "linkedin": "Canada",
        "indeed": "Remote",
        "glassdoor": "canada-it-support-jobs-SRCH_IL.0,6_IN3_KO7,17.htm",
        "score_keywords": ["remote", "canada", "work from home", "wfh"],
        "score_primary": 10,
    },
]

SCRAPE_INTERVAL_MINUTES = 30


def get_location_names() -> list[str]:
    """Return display names of all configured locations."""
    return [loc["name"] for loc in LOCATIONS]

# ──────────────────────────────────────────────
# Lock file management
# ──────────────────────────────────────────────


def _acquire_lock() -> None:
    """Write our PID to the lock file.  Exit if another instance is running."""
    if os.path.exists(LOCK_PATH):
        try:
            with open(LOCK_PATH, "r", encoding="utf-8") as fh:
                old_pid = int(fh.read().strip())
            # Check if that PID is actually alive
            try:
                import psutil
                if psutil.pid_exists(old_pid) and psutil.Process(old_pid).is_running():
                    logger.warning("Scraper already running (PID %d). Exiting.", old_pid)
                    sys.exit(0)
            except Exception:
                # psutil unavailable — be conservative
                pass
            # Stale lock file
            logger.info("Removing stale lock file (PID %d)", old_pid)
            os.remove(LOCK_PATH)
        except (ValueError, OSError):
            try:
                os.remove(LOCK_PATH)
            except OSError:
                pass

    with open(LOCK_PATH, "w", encoding="utf-8") as fh:
        fh.write(str(os.getpid()))
    logger.info("Lock acquired (PID %d)", os.getpid())


def _release_lock() -> None:
    """Remove the lock file if it belongs to us."""
    try:
        if os.path.exists(LOCK_PATH):
            os.remove(LOCK_PATH)
            logger.info("Lock released")
    except OSError:
        pass


# ──────────────────────────────────────────────
# Match scoring
# ──────────────────────────────────────────────


def calculate_match_score(
    title: str, snippet: str, location: str, tags_str: str, custom_query: str | None = None
) -> int:
    """Return an integer score 0-100 for how well a job matches the user profile."""
    score = 0
    title_lower = title.lower()
    text_lower = (snippet + " " + tags_str).lower()
    loc_lower = location.lower()

    # ── Custom Query Match ──
    if custom_query:
        if custom_query.lower() in title_lower:
            score += 45

    # ── Title matches ──
    strong_titles = [
        "it support",
        "sysadmin",
        "systems administrator",
        "cloud admin",
        "technical analyst",
        "infrastructure",
    ]
    if any(t in title_lower for t in strong_titles):
        score += 25

    moderate_titles = [
        "helpdesk",
        "help desk",
        "desktop support",
        "network administrator",
        "it analyst",
    ]
    if any(t in title_lower for t in moderate_titles):
        score += 15

    # ── Tech stack ──
    strong_tech = ["azure", "microsoft 365", "m365", "active directory", "intune"]
    if any(t in text_lower for t in strong_tech):
        score += 20

    moderate_tech = [
        "powershell",
        "windows server",
        "office 365",
        "exchange",
        "teams",
    ]
    if any(t in text_lower for t in moderate_tech):
        score += 10

    # ── Location (dynamic from LOCATIONS config) ──
    location_scored = False
    for loc_cfg in LOCATIONS:
        for kw in loc_cfg["score_keywords"]:
            if kw in loc_lower and not location_scored:
                score += loc_cfg["score_primary"]
                location_scored = True
                break
    # Remote always gets a bonus on top
    if "remote" in loc_lower or "work from home" in loc_lower:
        if not location_scored:
            score += 10

    # ── Experience ──
    entry_signals = [
        "1 year",
        "2 year",
        "3 year",
        "entry level",
        "junior",
        "0-2",
        "1-3",
        "2-4",
        "2-5",
    ]
    if any(s in text_lower for s in entry_signals):
        score += 10

    senior_signals = [
        "8+ years",
        "10+ years",
        "15+ years",
        "senior preferred",
        "10 years",
    ]
    if any(s in text_lower for s in senior_signals):
        score -= 10

    # ── Negative signals ──
    hard_negatives = [
        "commission",
        "unpaid",
        "volunteer",
        "must be authorized",
        "visa sponsorship not available",
    ]
    if any(s in text_lower for s in hard_negatives):
        score -= 30

    soft_negatives = ["15+ years", "20 years experience"]
    if any(s in text_lower for s in soft_negatives):
        score -= 20

    return max(0, min(100, score))


# ──────────────────────────────────────────────
# Tag extraction
# ──────────────────────────────────────────────

TAG_KEYWORDS = [
    "Azure",
    "AWS",
    "GCP",
    "M365",
    "Active Directory",
    "Intune",
    "PowerShell",
    "Python",
    "Linux",
    "Windows Server",
    "VMware",
    "Networking",
    "Cisco",
    "CCNA",
    "CompTIA",
    "ITIL",
    "Helpdesk",
    "Office 365",
    "Exchange",
    "Teams",
    "SharePoint",
    "Terraform",
    "Docker",
    "Kubernetes",
    "SCCM",
    "Group Policy",
]


def extract_tags(title: str, snippet: str) -> str:
    """Return a comma-separated string of matching tech keywords."""
    combined = (title + " " + snippet).lower()
    matched = [kw for kw in TAG_KEYWORDS if kw.lower() in combined]
    return ", ".join(matched)


# ──────────────────────────────────────────────
# URL helper
# ──────────────────────────────────────────────


def _clean_url(raw_url: str) -> str:
    """Strip query parameters from a URL."""
    try:
        parsed = urlparse(raw_url)
        return urlunparse(parsed._replace(query="", fragment=""))
    except Exception:
        return raw_url


# ──────────────────────────────────────────────
# Scraper: LinkedIn
# ──────────────────────────────────────────────


async def scrape_linkedin(page, rate_limiter, location_cfg: dict | None = None, query_list: list[str] | None = None) -> list[dict]:
    """Scrape LinkedIn job listings (public search, no login)."""
    from stealth import check_captcha, human_delay, human_mouse_move, human_scroll

    loc_param = (location_cfg or LOCATIONS[0])["linkedin"]
    loc_name = (location_cfg or LOCATIONS[0])["name"]

    jobs: list[dict] = []
    active_queries = query_list if query_list else SEARCH_QUERIES
    
    for query in active_queries:
        if not rate_limiter.can_request("linkedin"):
            break

        import urllib.parse
        encoded_query = urllib.parse.quote(query)

        url = (
            "https://www.linkedin.com/jobs/search/"
            f"?keywords={encoded_query}"
            f"&location={loc_param}"
            "&f_TPR=r86400&position=1&pageNum=0"
        )

        try:
            await page.goto(url, timeout=15000)
            rate_limiter.record_request("linkedin")
            await page.wait_for_load_state("domcontentloaded")

            if await check_captcha(page, "LinkedIn"):
                continue

            # Check for login redirect / auth wall
            current = page.url.lower()
            if "login" in current or "authwall" in current:
                logger.warning("LinkedIn requires login, skipping query %s", query)
                continue

            await human_delay()
            await human_mouse_move(page)
            await human_scroll(page)

            # Wait for results container or individual card elements to load
            try:
                await page.wait_for_selector(
                    ".jobs-search__results-list, .base-card, .base-search-card", timeout=15000
                )
            except Exception:
                try:
                    title = await page.title()
                    url_curr = page.url
                    logger.warning(
                        "LinkedIn: results container not found for %s. Page title: %r, URL: %s",
                        query, title, url_curr
                    )
                except Exception:
                    logger.warning("LinkedIn: results container not found for %s", query)
                continue

            # Pagination — scroll to load more cards
            for _ in range(2):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(1.5)

            # Extract job cards
            cards = await page.query_selector_all(".jobs-search__results-list > li, .base-card, .base-search-card")
            
            for card in cards:
                try:
                    # Title
                    title_el = await card.query_selector(
                        "h3.base-search-card__title, .base-card__full-link, .job-search-card__title, h3"
                    )
                    title = (await title_el.inner_text()).strip() if title_el else ""

                    # Company
                    company_el = await card.query_selector(
                        "h4.base-search-card__subtitle, .job-search-card__company-name, .base-search-card__subtitle, h4"
                    )
                    company = (
                        (await company_el.inner_text()).strip() if company_el else ""
                    )

                    # Location
                    location_el = await card.query_selector(
                        "span.job-search-card__location, .job-search-card__location, .base-search-card__metadata-item"
                    )
                    loc = (
                        (await location_el.inner_text()).strip() if location_el else ""
                    )

                    # Date posted
                    time_el = await card.query_selector("time[datetime]")
                    date_posted = ""
                    if time_el:
                        date_posted = (
                            await time_el.get_attribute("datetime") or ""
                        )

                    # URL
                    link_el = await card.query_selector("a.base-card__full-link, a.base-search-card__title-link, a")
                    raw_href = (
                        await link_el.get_attribute("href") if link_el else ""
                    ) or ""
                    job_url = _clean_url(raw_href)

                    # Snippet
                    snippet_el = await card.query_selector(
                        ".job-search-card__snippet, .base-search-card__metadata"
                    )
                    snippet = (
                        (await snippet_el.inner_text()).strip() if snippet_el else ""
                    )

                    if title and company:
                        jobs.append(
                            {
                                "title": title,
                                "company": company,
                                "location": loc,
                                "salary": "Not listed",
                                "url": job_url,
                                "snippet": snippet,
                                "date_posted": date_posted,
                                "source": "LinkedIn",
                            }
                        )
                except Exception:
                    logger.debug("LinkedIn: failed to parse a card", exc_info=True)
                    continue

        except Exception as exc:
            logger.error("LinkedIn scrape failed for %s: %s", query, exc, exc_info=True)
            continue
            
    logger.info("LinkedIn [%s]: extracted %d jobs total", loc_name, len(jobs))
    return jobs


# ──────────────────────────────────────────────
# Scraper: Indeed (CA)
# ──────────────────────────────────────────────


async def scrape_indeed(page, rate_limiter, location_cfg: dict | None = None, query_list: list[str] | None = None) -> list[dict]:
    """Scrape Indeed Canada job listings (3 pages max)."""
    from stealth import check_captcha, human_delay, human_mouse_move

    if not rate_limiter.can_request("indeed"):
        logger.info("Indeed: rate limit reached, skipping")
        return []

    loc_param = (location_cfg or LOCATIONS[0])["indeed"]
    loc_name = (location_cfg or LOCATIONS[0])["name"]
    loc_keywords = [kw for kw in (location_cfg or LOCATIONS[0])["score_keywords"]]
    # Also always accept 'remote'
    loc_keywords.append("remote")

    jobs: list[dict] = []
    active_queries = query_list if query_list else SEARCH_QUERIES

    for query in active_queries:
        if not rate_limiter.can_request("indeed"):
            break

        import urllib.parse
        encoded_query = urllib.parse.quote(query)

        url = (
            f"https://ca.indeed.com/jobs?q={encoded_query}"
            f"&l={loc_param}&fromage=1&start=0"
        )

        try:
            await page.goto(url, timeout=15000)
            rate_limiter.record_request("indeed")
            await page.wait_for_load_state("domcontentloaded")

            if await check_captcha(page, "Indeed"):
                continue

            await human_delay()
            await human_mouse_move(page)

            # --- 1. Try JSON-based Extraction via window.mosaic ---
            json_jobs = []
            try:
                # Wait 2 seconds for JS execution and client-side setup
                await asyncio.sleep(2.0)
                
                jobcards_data = await page.evaluate(
                    '() => window.mosaic && window.mosaic.providerData && window.mosaic.providerData["mosaic-provider-jobcards"]'
                )
                
                if jobcards_data and isinstance(jobcards_data, dict):
                    results = jobcards_data.get("metaData", {}).get("mosaicProviderJobCardsModel", {}).get("results", [])
                    logger.info("Indeed JSON: Found %d structured job listings inside window.mosaic", len(results))
                    for job in results:
                        try:
                            title = job.get("title", "").strip()
                            company = job.get("company", "").strip()
                            
                            # Location
                            loc = job.get("formattedLocation", "").strip() or job.get("location", "").strip()
                            loc_lower = loc.lower()
                            if not any(kw in loc_lower for kw in loc_keywords):
                                continue
                                
                            # Salary
                            salary = "Not listed"
                            salary_snippet = job.get("salarySnippet")
                            if salary_snippet and isinstance(salary_snippet, dict):
                                salary = salary_snippet.get("text", "Not listed")
                            elif not salary_snippet:
                                estimated_salary = job.get("estimatedSalary")
                                if estimated_salary and isinstance(estimated_salary, dict):
                                    salary = estimated_salary.get("text", "Not listed")
                                    
                            # Job URL from jobkey
                            jk = job.get("jobkey")
                            job_url = f"https://ca.indeed.com/viewjob?jk={jk}" if jk else ""
                            
                            # Skip sponsored
                            if job.get("sponsored") or "sponsored=true" in job_url.lower():
                                continue
                                
                            # Snippet
                            snippet = job.get("snippet", "").strip()
                            if snippet:
                                # Clean HTML tags (e.g. <b> or <br>) from snippet description
                                snippet = re.sub(r'<[^>]*>', '', snippet).strip()
                                
                            # Date Posted
                            pub_date = job.get("pubDate")
                            date_posted = ""
                            if pub_date:
                                try:
                                    dt = datetime.fromtimestamp(pub_date / 1000, tz=timezone.utc)
                                    date_posted = dt.strftime("%Y-%m-%d")
                                except Exception:
                                    pass
                            
                            if not date_posted:
                                age = job.get("age", "")
                                if age:
                                    date_posted = age
                                    
                            if title and company:
                                json_jobs.append({
                                    "title": title,
                                    "company": company,
                                    "location": loc,
                                    "salary": salary,
                                    "url": job_url,
                                    "snippet": snippet,
                                    "date_posted": date_posted,
                                    "source": "Indeed",
                                })
                        except Exception as item_err:
                            logger.debug("Indeed JSON: Failed to parse individual listing: %s", item_err)
                            continue
            except Exception as json_err:
                logger.warning("Indeed: JSON extraction encountered error: %s", json_err)

            if json_jobs:
                jobs.extend(json_jobs)
                logger.info("Indeed [%s]: Successfully extracted %d matching jobs using JSON state", loc_name, len(json_jobs))
            else:
                logger.info("Indeed: Falling back to DOM-based parsing for query: %s", query)
                # Wait for results container or individual card elements to load
                try:
                    await page.wait_for_selector(
                        ".jobsearch-ResultsList, #mosaic-provider-jobcards, .job_seen_beacon, [data-testid='slider_item']",
                        timeout=15000
                    )
                except Exception:
                    try:
                        title = await page.title()
                        url_curr = page.url
                        logger.warning(
                            "Indeed: results container not found for %s. Page title: %r, URL: %s",
                            query, title, url_curr
                        )
                    except Exception:
                        logger.warning(
                            "Indeed: results container not found for %s", query
                        )
                    continue

                # Extract cards
                cards = await page.query_selector_all(
                    ".job_seen_beacon, [data-testid='slider_item']"
                )

                for card in cards:
                    try:
                        # Title
                        title_el = await card.query_selector(
                            "[data-testid='job-title'] span, h2.jobTitle span, a.jcs-JobTitle span, h2, a"
                        )
                        title = (
                            (await title_el.inner_text()).strip() if title_el else ""
                        )

                        # Company
                        company_el = await card.query_selector(
                            "[data-testid='company-name'], span.companyName, .company_name, [data-testid='companyName']"
                        )
                        company = (
                            (await company_el.inner_text()).strip()
                            if company_el
                            else ""
                        )

                        # Location
                        location_el = await card.query_selector(
                            "[data-testid='text-location'], div.companyLocation, .company_location, .location"
                        )
                        loc = (
                            (await location_el.inner_text()).strip()
                            if location_el
                            else ""
                        )

                        # Filter by location — accept configured keywords + remote
                        loc_lower = loc.lower()
                        if not any(
                            kw in loc_lower
                            for kw in loc_keywords
                        ):
                            continue

                        # Salary
                        salary_el = await card.query_selector(
                            "[data-testid='attribute_snippet_testid'], .salary-snippet, .estimated-salary"
                        )
                        salary = (
                            (await salary_el.inner_text()).strip()
                            if salary_el
                            else "Not listed"
                        )

                        # URL — construct from job id (check container first, then anchors)
                        job_url = ""
                        jk = await card.get_attribute("data-jk")
                        if jk:
                            job_url = f"https://ca.indeed.com/viewjob?jk={jk}"
                        else:
                            link_el = await card.query_selector("a[data-jk]")
                            if link_el:
                                jk = await link_el.get_attribute("data-jk")
                                if jk:
                                    job_url = f"https://ca.indeed.com/viewjob?jk={jk}"
                        
                        # Fallback: raw href
                        if not job_url:
                            link_el = await card.query_selector("a[href]")
                            if link_el:
                                href = await link_el.get_attribute("href") or ""
                                if href:
                                    job_url = (
                                        f"https://ca.indeed.com{href}"
                                        if href.startswith("/")
                                        else href
                                    )

                        # Skip sponsored
                        if "sponsored=true" in job_url.lower():
                            continue

                        # Snippet
                        snippet_el = await card.query_selector(
                            ".job-snippet span, .job-snippet, .jobCardCondition"
                        )
                        snippet = (
                            (await snippet_el.inner_text()).strip()
                            if snippet_el
                            else ""
                        )

                        if title and company:
                            jobs.append(
                                {
                                    "title": title,
                                    "company": company,
                                    "location": loc,
                                    "salary": salary,
                                    "url": job_url,
                                    "snippet": snippet,
                                    "date_posted": "",
                                    "source": "Indeed",
                                }
                            )
                    except Exception:
                        logger.debug(
                            "Indeed: failed to parse a card", exc_info=True
                        )
                        continue

        except Exception as exc:
            logger.error(
                "Indeed scrape failed for %s: %s", query, exc, exc_info=True
            )
            continue

        await human_delay()

    logger.info("Indeed [%s]: extracted %d jobs", loc_name, len(jobs))
    return jobs


# ──────────────────────────────────────────────
# Scraper: Glassdoor (CA)
# ──────────────────────────────────────────────


async def scrape_glassdoor(page, rate_limiter, location_cfg: dict | None = None) -> list[dict]:
    """Scrape Glassdoor Canada job listings."""
    from stealth import check_captcha, human_delay, human_mouse_move

    if not rate_limiter.can_request("glassdoor"):
        logger.info("Glassdoor: rate limit reached, skipping")
        return []

    loc_slug = (location_cfg or LOCATIONS[0])["glassdoor"]
    loc_name = (location_cfg or LOCATIONS[0])["name"]

    url = (
        "https://www.glassdoor.ca/Job/"
        f"{loc_slug}"
    )

    try:
        await page.goto(url, timeout=20000)
        rate_limiter.record_request("glassdoor")
        await page.wait_for_load_state("domcontentloaded")

        if await check_captcha(page, "Glassdoor"):
            return []

        # Dismiss login-wall modal if present
        modal = await page.query_selector('[data-test="modal"]')
        if modal:
            logger.warning("Glassdoor login wall detected, skipping")
            return []

        await human_delay()
        await human_mouse_move(page)

        # Extract cards
        cards = await page.query_selector_all('[data-test="jobListing"]')
        jobs: list[dict] = []

        for card in cards:
            try:
                # Title
                title_el = await card.query_selector(
                    '[data-test="job-title"]'
                )
                title = (
                    (await title_el.inner_text()).strip() if title_el else ""
                )

                # Company
                company_el = await card.query_selector(
                    '[data-test="employer-name"]'
                )
                company = (
                    (await company_el.inner_text()).strip()
                    if company_el
                    else ""
                )

                # Location
                location_el = await card.query_selector(
                    '[data-test="emp-location"]'
                )
                loc = (
                    (await location_el.inner_text()).strip()
                    if location_el
                    else ""
                )

                # Salary
                salary_el = await card.query_selector(
                    '[data-test="detailSalary"]'
                )
                salary = (
                    (await salary_el.inner_text()).strip()
                    if salary_el
                    else "Not listed"
                )

                # URL
                link_el = await card.query_selector("a[href]")
                raw_href = (
                    await link_el.get_attribute("href") if link_el else ""
                ) or ""
                if raw_href.startswith("/"):
                    job_url = f"https://www.glassdoor.ca{raw_href}"
                else:
                    job_url = raw_href

                # Snippet
                snippet_el = await card.query_selector(
                    '[data-test="job-description-text"]'
                )
                snippet_text = ""
                if snippet_el:
                    full = (await snippet_el.inner_text()).strip()
                    snippet_text = full[:200]

                if title and company:
                    jobs.append(
                        {
                            "title": title,
                            "company": company,
                            "location": loc,
                            "salary": salary,
                            "url": job_url,
                            "snippet": snippet_text,
                            "date_posted": "",
                            "source": "Glassdoor",
                        }
                    )
            except Exception:
                logger.debug(
                    "Glassdoor: failed to parse a card", exc_info=True
                )
                continue

        logger.info("Glassdoor [%s]: extracted %d jobs", loc_name, len(jobs))
        return jobs

    except Exception as exc:
        logger.error("Glassdoor scrape failed: %s", exc, exc_info=True)
        return []


# ──────────────────────────────────────────────
# Main scrape cycle
# ──────────────────────────────────────────────


async def run_scrape_cycle(trigger_data: dict | None = None) -> None:
    """Execute one full scrape cycle across all sources."""
    from database import (
        init_db,
        job_exists,
        insert_job,
        update_job_seen,
        mark_inactive,
        get_new_unnotified,
        mark_notified,
        log_scrape,
    )
    from stealth import get_stealth_context, RateLimiter, COOKIES_PATH
    import urllib.parse

    logger.info("Starting scrape cycle")
    started_at = datetime.now(timezone.utc).isoformat()
    total_found = 0
    total_new = 0

    # Resolve custom parameters if manual scrape is triggered with options
    if trigger_data and (trigger_data.get("query") or trigger_data.get("location")):
        custom_query = trigger_data.get("query")
        custom_loc = trigger_data.get("location")
        
        if custom_loc:
            loc_list = [
                {
                    "name": custom_loc,
                    "linkedin": urllib.parse.quote(custom_loc),
                    "indeed": urllib.parse.quote(custom_loc),
                    "score_keywords": [kw.strip().lower() for kw in custom_loc.replace(",", " ").split() if kw.strip()],
                    "score_primary": 25,
                }
            ]
        else:
            loc_list = LOCATIONS
            
        if custom_query:
            query_list = [custom_query]
        else:
            query_list = SEARCH_QUERIES
    else:
        custom_query = None
        loc_list = LOCATIONS
        query_list = SEARCH_QUERIES

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser, context, page = await get_stealth_context(p)
            rate_limiter = RateLimiter()

            try:
                sources = [
                    ("Glassdoor", scrape_glassdoor),
                    ("LinkedIn", scrape_linkedin),
                ]

                for source_name, scrape_func in sources:
                  for location_cfg in loc_list:
                    # Abort default cycle early if a manual trigger is written
                    if not trigger_data and os.path.exists(TRIGGER_PATH):
                        logger.info("Default scrape cycle aborted because a manual trigger is pending")
                        return

                    # Glassdoor lacks generic search capabilities, so skip custom items
                    if source_name == "Glassdoor" and "glassdoor" not in location_cfg:
                        logger.info("Skipping Glassdoor scraping for custom location: %s", location_cfg["name"])
                        continue

                    try:
                        logger.info(
                            "Scraping %s for %s",
                            source_name,
                            location_cfg["name"],
                        )
                        if source_name in ["Indeed", "LinkedIn"]:
                            raw_jobs = await scrape_func(
                                page, rate_limiter, location_cfg, query_list=query_list
                            )
                        else:
                            raw_jobs = await scrape_func(
                                page, rate_limiter, location_cfg
                            )
                        source_new = 0

                        for job_data in raw_jobs:
                            # Clean all string values
                            for key in list(job_data.keys()):
                                if isinstance(job_data[key], str):
                                    job_data[key] = (
                                        " ".join(job_data[key].split()).strip()
                                    )

                            # Generate deterministic ID from title + company
                            job_id = hashlib.md5(
                                (
                                    job_data["title"].lower().strip()
                                    + job_data["company"].lower().strip()
                                ).encode("utf-8")
                            ).hexdigest()

                            if await job_exists(job_id):
                                await update_job_seen(job_id)
                            else:
                                tags = extract_tags(
                                    job_data["title"],
                                    job_data.get("snippet", ""),
                                )
                                score = calculate_match_score(
                                    job_data["title"],
                                    job_data.get("snippet", ""),
                                    job_data.get("location", ""),
                                    tags,
                                    custom_query=custom_query,
                                )
                                now_iso = datetime.now(timezone.utc).isoformat()
                                job = {
                                    "id": job_id,
                                    "title": job_data["title"],
                                    "company": job_data["company"],
                                    "location": job_data.get("location", ""),
                                    "salary": job_data.get(
                                        "salary", "Not listed"
                                    ),
                                    "url": job_data.get("url", ""),
                                    "source": source_name,
                                    "snippet": job_data.get("snippet", ""),
                                    "tags": tags,
                                    "match_score": score,
                                    "date_found": now_iso,
                                    "date_posted": job_data.get(
                                        "date_posted", ""
                                    ),
                                    "last_seen": now_iso,
                                }
                                await insert_job(job)
                                source_new += 1

                        total_found += len(raw_jobs)
                        total_new += source_new

                        await log_scrape(
                            {
                                "started_at": started_at,
                                "finished_at": datetime.now(
                                    timezone.utc
                                ).isoformat(),
                                "jobs_found": len(raw_jobs),
                                "jobs_new": source_new,
                                "source": f"{source_name} ({location_cfg['name']})",
                                "status": "success",
                                "error": None,
                            }
                        )

                    except Exception as exc:
                        logger.error(
                            "%s scrape failed: %s",
                            source_name,
                            exc,
                            exc_info=True,
                        )
                        await log_scrape(
                            {
                                "started_at": started_at,
                                "finished_at": datetime.now(
                                    timezone.utc
                                ).isoformat(),
                                "jobs_found": 0,
                                "jobs_new": 0,
                                "source": source_name,
                                "status": "failed",
                                "error": str(exc),
                            }
                        )

                # After all sources — mark stale jobs inactive
                await mark_inactive()

                # Desktop notifications for new jobs
                new_jobs = await get_new_unnotified()
                if new_jobs:
                    from notifier import notify_new_jobs

                    notify_new_jobs(new_jobs)
                    await mark_notified([j["id"] for j in new_jobs])

                # Persist cookies on success
                try:
                    await context.storage_state(path=COOKIES_PATH)
                except Exception:
                    pass

            finally:
                try:
                    await context.close()
                except Exception:
                    logger.debug("Failed to close browser context", exc_info=True)
                try:
                    await browser.close()
                except Exception:
                    logger.debug("Failed to close browser", exc_info=True)

    except Exception as exc:
        logger.error("Scrape cycle failed: %s", exc, exc_info=True)

    logger.info(
        "Scrape cycle complete. Found %d jobs, %d new.", total_found, total_new
    )


# ──────────────────────────────────────────────
# Trigger file check
# ──────────────────────────────────────────────


async def check_trigger() -> dict | None:
    """Read the trigger file, delete it, and return parsed JSON data if valid."""
    if os.path.exists(TRIGGER_PATH):
        data = None
        try:
            with open(TRIGGER_PATH, "r", encoding="utf-8") as fh:
                content = fh.read().strip()
                if content:
                    try:
                        import json
                        data = json.loads(content)
                    except Exception:
                        pass
            os.remove(TRIGGER_PATH)
        except OSError:
            pass
        return data if data is not None else {}
    return None


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────


async def main() -> None:
    """Infinite scrape loop with 30-minute interval and trigger support."""
    from database import init_db

    _acquire_lock()
    atexit.register(_release_lock)

    try:
        await init_db()

        while True:
            # Prioritize checking manual trigger before starting the default slow background cycle
            trigger_data = await check_trigger()
            if trigger_data is not None:
                logger.info("Manual scrape triggered on boot/loop check: %s", trigger_data)
                try:
                    await run_scrape_cycle(trigger_data)
                except Exception as exc:
                    logger.error("Triggered scrape cycle failed: %s", exc, exc_info=True)
            else:
                try:
                    await run_scrape_cycle()
                except Exception as exc:
                    logger.error("Scrape cycle failed: %s", exc, exc_info=True)

            # Wait ~30 minutes, but poll for trigger every 10 seconds
            for _ in range(SCRAPE_INTERVAL_MINUTES * 6):  # 180 iterations × 10 s = 30 min
                await asyncio.sleep(10)
                trigger_data = await check_trigger()
                if trigger_data is not None:
                    logger.info("Manual scrape triggered with custom configuration: %s", trigger_data)
                    try:
                        await run_scrape_cycle(trigger_data)
                    except Exception as exc:
                        logger.error("Triggered scrape cycle failed: %s", exc, exc_info=True)
                    break
                # Touch lock file so watchdog knows we're alive
                try:
                    Path(LOCK_PATH).touch()
                except OSError:
                    pass
    finally:
        _release_lock()


if __name__ == "__main__":
    asyncio.run(main())
