"""
database.py — Async PostgreSQL database layer for JobHunter.

Uses asyncpg for concurrent async database operations with Neon PostgreSQL.
"""

import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import logging
from datetime import datetime, timezone
import asyncpg

logger = logging.getLogger(__name__)

# Neon PostgreSQL connection string (with environment variable override support)
POSTGRES_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_w7L8rCIBVXAJ@ep-lingering-frost-aq86xl1u.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require"
)


def _utcnow_iso() -> str:
    """Return current UTC time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


async def _get_db() -> asyncpg.Connection:
    """Open a connection to Neon PostgreSQL."""
    return await asyncpg.connect(POSTGRES_URL)


# ──────────────────────────────────────────────
# Schema bootstrap
# ──────────────────────────────────────────────

async def init_db() -> None:
    """Create all tables if they do not exist."""
    db = await _get_db()
    try:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS jobs (
                id                TEXT PRIMARY KEY,
                title             TEXT NOT NULL,
                company           TEXT NOT NULL,
                location          TEXT,
                salary            TEXT DEFAULT 'Not listed',
                url               TEXT,
                source            TEXT,
                snippet           TEXT,
                description       TEXT,
                tags              TEXT,
                status            TEXT DEFAULT 'new',
                is_new            INTEGER DEFAULT 1,
                is_active         INTEGER DEFAULT 1,
                match_score       INTEGER DEFAULT 0,
                scrape_count      INTEGER DEFAULT 1,
                consecutive_misses INTEGER DEFAULT 0,
                notified          INTEGER DEFAULT 0,
                date_found        TEXT,
                date_posted       TEXT,
                last_seen         TEXT
            );

            CREATE TABLE IF NOT EXISTS users (
                id                 TEXT PRIMARY KEY,
                email              TEXT NOT NULL,
                name               TEXT NOT NULL,
                picture            TEXT,
                password_hash      TEXT,
                email_verified     INTEGER DEFAULT 0,
                verification_token TEXT,
                created_at         TEXT
            );

            CREATE TABLE IF NOT EXISTS user_jobs (
                user_id     TEXT,
                job_id      TEXT,
                status      TEXT,
                notified    INTEGER DEFAULT 0,
                updated_at  TEXT,
                PRIMARY KEY (user_id, job_id)
            );

            CREATE TABLE IF NOT EXISTS scrape_log (
                id          SERIAL PRIMARY KEY,
                started_at  TEXT,
                finished_at TEXT,
                jobs_found  INTEGER,
                jobs_new    INTEGER,
                source      TEXT,
                status      TEXT,
                error       TEXT
            );
            """
        )
        # Apply PostgreSQL schema migration upgrades natively for existing database runs
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT")
        await db.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT")

        # Seed schema_version if empty
        row = await db.fetchrow("SELECT COUNT(*) FROM schema_version")
        if row[0] == 0:
            await db.execute("INSERT INTO schema_version (version) VALUES ($1)", 6)
        logger.info("PostgreSQL database initialised")
    except Exception:
        logger.exception("Failed to initialise PostgreSQL database")
        raise
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Job CRUD
# ──────────────────────────────────────────────

async def job_exists(job_id: str) -> bool:
    """Return True if a job with *job_id* already exists."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT 1 FROM jobs WHERE id = $1", job_id)
        return row is not None
    finally:
        await db.close()


async def insert_job(job: dict) -> None:
    """Insert a new job row from a dict whose keys match the column names."""
    db = await _get_db()
    try:
        await db.execute(
            """
            INSERT INTO jobs (
                id, title, company, location, salary, url, source,
                snippet, description, tags, status, is_new, is_active, match_score,
                scrape_count, consecutive_misses, notified,
                date_found, date_posted, last_seen
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, 'new', 1, 1, $11,
                1, 0, 0,
                $12, $13, $14
            )
            ON CONFLICT (id) DO NOTHING
            """,
            job["id"],
            job["title"],
            job["company"],
            job.get("location"),
            job.get("salary", "Not listed"),
            job.get("url"),
            job.get("source"),
            job.get("snippet"),
            job.get("description"),
            job.get("tags"),
            job.get("match_score", 0),
            job.get("date_found"),
            job.get("date_posted"),
            job.get("last_seen"),
        )
        logger.debug("Inserted job %s — %s at %s", job["id"], job["title"], job["company"])
    except Exception:
        logger.exception("Failed to insert job %s", job.get("id"))
        raise
    finally:
        await db.close()


async def update_job_seen(job_id: str) -> None:
    """Increment scrape_count, reset consecutive_misses, update last_seen."""
    db = await _get_db()
    try:
        await db.execute(
            """
            UPDATE jobs
               SET scrape_count      = scrape_count + 1,
                   consecutive_misses = 0,
                   last_seen          = $1,
                   is_active          = 1
             WHERE id = $2
            """,
            _utcnow_iso(),
            job_id,
        )
    finally:
        await db.close()


async def mark_inactive() -> None:
    """Increment consecutive_misses for all active jobs NOT seen this cycle,
    then deactivate any job that has missed 3+ consecutive cycles.
    """
    db = await _get_db()
    try:
        # Get the most recent scrape start time as a cycle boundary
        row = await db.fetchrow(
            "SELECT started_at FROM scrape_log ORDER BY id DESC LIMIT 1"
        )
        if row is None:
            return  # No scrapes recorded yet

        cycle_boundary = row["started_at"]

        # Increment misses for active jobs not seen in the current cycle
        await db.execute(
            """
            UPDATE jobs
               SET consecutive_misses = consecutive_misses + 1
             WHERE is_active = 1
               AND (last_seen IS NULL OR last_seen < $1)
            """,
            cycle_boundary,
        )

        # Deactivate jobs that have missed 3 or more consecutive cycles
        await db.execute(
            """
            UPDATE jobs
               SET is_active = 0
             WHERE consecutive_misses >= 3
            """
        )
        logger.info("mark_inactive complete (cycle boundary: %s)", cycle_boundary)
    except Exception:
        logger.exception("mark_inactive failed")
    finally:
        await db.close()


async def get_job_description(job_id: str) -> str | None:
    """Return the description for a job, or None."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT description FROM jobs WHERE id = $1", job_id)
        return row["description"] if row else None
    finally:
        await db.close()


async def update_job_description(job_id: str, description: str) -> None:
    """Update a job's description."""
    db = await _get_db()
    try:
        await db.execute("UPDATE jobs SET description = $1 WHERE id = $2", description, job_id)
    finally:
        await db.close()


async def get_all_jobs(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    active_only: bool = True,
    user_id: str | None = None,
) -> dict:
    """Return a paginated dict: {jobs, total, offset, limit, has_more}.

    If user_id is provided, includes the user's specific status overrides.
    """
    db = await _get_db()
    try:
        conditions: list[str] = []
        params: list = []
        p_idx = 1

        if active_only:
            conditions.append("jobs.is_active = 1")

        if user_id:
            params.append(user_id)
            p_idx += 1
            # User specific status filtering
            if status:
                if status == "new":
                    conditions.append("COALESCE(uj.status, 'new') = 'new'")
                else:
                    conditions.append(f"uj.status = ${p_idx}")
                    params.append(status)
                    p_idx += 1
        else:
            if status:
                conditions.append(f"jobs.status = ${p_idx}")
                params.append(status)
                p_idx += 1

        if search:
            conditions.append(
                f"(jobs.title ILIKE ${p_idx} OR jobs.company ILIKE ${p_idx+1} OR jobs.tags ILIKE ${p_idx+2} OR jobs.snippet ILIKE ${p_idx+3})"
            )
            like_val = f"%{search}%"
            params.extend([like_val, like_val, like_val, like_val])
            p_idx += 4

        where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

        # Total count query
        if user_id:
            count_sql = (
                f"SELECT COUNT(*) FROM jobs "
                f"LEFT JOIN user_jobs uj ON jobs.id = uj.job_id AND uj.user_id = $1 "
                f"{where}"
            )
            total = await db.fetchval(count_sql, *params)
        else:
            count_sql = f"SELECT COUNT(*) FROM jobs {where}"
            total = await db.fetchval(count_sql, *params)

        # Fetch page query
        limit_idx = p_idx
        offset_idx = p_idx + 1
        params.extend([limit, offset])

        if user_id:
            query_sql = (
                f"SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.salary, jobs.url, jobs.source, jobs.description, "
                f"jobs.snippet, jobs.tags, jobs.match_score, jobs.scrape_count, jobs.consecutive_misses, "
                f"jobs.date_found, jobs.date_posted, jobs.last_seen, jobs.is_active, "
                f"COALESCE(uj.status, 'new') as status, "
                f"COALESCE(uj.notified, 0) as notified, "
                f"CASE WHEN uj.job_id IS NULL THEN 1 ELSE 0 END as is_new "
                f"FROM jobs "
                f"LEFT JOIN user_jobs uj ON jobs.id = uj.job_id AND uj.user_id = $1 "
                f"{where} "
                f"ORDER BY jobs.match_score DESC, jobs.date_found DESC LIMIT ${limit_idx} OFFSET ${offset_idx}"
            )
            rows = await db.fetch(query_sql, *params)
        else:
            query_sql = (
                f"SELECT * FROM jobs {where} ORDER BY match_score DESC, date_found DESC LIMIT ${limit_idx} OFFSET ${offset_idx}"
            )
            rows = await db.fetch(query_sql, *params)

        jobs = [dict(r) for r in rows]

        return {
            "jobs": jobs,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total,
        }
    finally:
        await db.close()


async def get_new_unnotified() -> list[dict]:
    """Return jobs where is_new = 1 AND notified = 0."""
    db = await _get_db()
    try:
        rows = await db.fetch(
            "SELECT * FROM jobs WHERE is_new = 1 AND notified = 0"
        )
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def mark_notified(ids: list[str]) -> None:
    """Set notified = 1 for every job id in *ids*."""
    if not ids:
        return
    db = await _get_db()
    try:
        await db.execute(
            "UPDATE jobs SET notified = 1 WHERE id = ANY($1)", ids
        )
    finally:
        await db.close()


async def update_status(job_id: str, status: str, user_id: str | None = None) -> None:
    """Update the status for a job (either user-specific or global fallback)."""
    db = await _get_db()
    try:
        if user_id:
            await db.execute(
                """
                INSERT INTO user_jobs (user_id, job_id, status, notified, updated_at)
                VALUES ($1, $2, $3, 0, $4)
                ON CONFLICT(user_id, job_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                user_id,
                job_id,
                status,
                _utcnow_iso()
            )
        else:
            await db.execute(
                "UPDATE jobs SET status = $1, is_new = 0 WHERE id = $2", status, job_id
            )
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Users CRUD helpers
# ──────────────────────────────────────────────

async def upsert_user(user_id: str, email: str, name: str, picture: str | None) -> None:
    """Insert or update user details upon Google authentication."""
    db = await _get_db()
    try:
        await db.execute(
            """
            INSERT INTO users (id, email, name, picture, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(id) DO UPDATE SET
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                picture = EXCLUDED.picture
            """,
            user_id,
            email,
            name,
            picture,
            _utcnow_iso()
        )
    finally:
        await db.close()


async def get_user(user_id: str) -> dict | None:
    """Fetch user details by ID."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        return dict(row) if row else None
    finally:
        await db.close()


async def get_user_by_email(email: str) -> dict | None:
    """Fetch user details by email."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT * FROM users WHERE email = $1", email)
        return dict(row) if row else None
    finally:
        await db.close()


async def verify_user_email(token: str) -> dict | None:
    """Verify email matching the token, activate the user, and clear token. Returns user dict on success."""
    db = await _get_db()
    try:
        row = await db.fetchrow("SELECT * FROM users WHERE verification_token = $1", token)
        if not row:
            return None
        user = dict(row)
        await db.execute(
            "UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = $1",
            user["id"]
        )
        return user
    finally:
        await db.close()


async def create_custom_user(user_id: str, email: str, name: str, password_hash: str, verification_token: str) -> None:
    """Insert a new custom email/password user with verification pending."""
    db = await _get_db()
    try:
        await db.execute(
            """
            INSERT INTO users (id, email, name, password_hash, email_verified, verification_token, created_at)
            VALUES ($1, $2, $3, $4, 0, $5, $6)
            """,
            user_id,
            email,
            name,
            password_hash,
            verification_token,
            _utcnow_iso()
        )
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Stats & Logs
# ──────────────────────────────────────────────

async def get_stats(user_id: str | None = None) -> dict:
    """Aggregate counts per status and attach the latest scrape_log entry."""
    db = await _get_db()
    try:
        # Counts by status (user specific if user_id is provided)
        if user_id:
            rows = await db.fetch(
                """
                SELECT COALESCE(uj.status, 'new') as status, COUNT(*) as cnt
                FROM jobs
                LEFT JOIN user_jobs uj ON jobs.id = uj.job_id AND uj.user_id = $1
                WHERE jobs.is_active = 1
                GROUP BY COALESCE(uj.status, 'new')
                """,
                user_id
            )
        else:
            rows = await db.fetch(
                "SELECT status, COUNT(*) as cnt FROM jobs WHERE is_active = 1 GROUP BY status"
            )
        
        status_counts = {r["status"]: r["cnt"] for r in rows}

        # Total active
        total_active = await db.fetchval("SELECT COUNT(*) FROM jobs WHERE is_active = 1")

        # Total inactive
        total_inactive = await db.fetchval("SELECT COUNT(*) FROM jobs WHERE is_active = 0")

        # Last scrape
        last_scrape_row = await db.fetchrow(
            "SELECT * FROM scrape_log ORDER BY id DESC LIMIT 1"
        )
        last_scrape = dict(last_scrape_row) if last_scrape_row else None

        return {
            "status_counts": status_counts,
            "total_active": total_active,
            "total_inactive": total_inactive,
            "last_scrape": last_scrape,
        }
    finally:
        await db.close()


async def log_scrape(data: dict) -> None:
    """Insert a row into scrape_log."""
    db = await _get_db()
    try:
        await db.execute(
            """
            INSERT INTO scrape_log (started_at, finished_at, jobs_found, jobs_new, source, status, error)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            data.get("started_at"),
            data.get("finished_at"),
            data.get("jobs_found", 0),
            data.get("jobs_new", 0),
            data.get("source"),
            data.get("status"),
            data.get("error"),
        )
    finally:
        await db.close()


async def get_scrape_logs(limit: int = 20) -> list[dict]:
    """Return the most recent scrape_log entries."""
    db = await _get_db()
    try:
        rows = await db.fetch(
            "SELECT * FROM scrape_log ORDER BY id DESC LIMIT $1", limit
        )
        return [dict(r) for r in rows]
    finally:
        await db.close()
