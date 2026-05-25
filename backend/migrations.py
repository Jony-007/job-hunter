"""
migrations.py — Schema migration runner for JobHunter.

Reads the current version from the schema_version table and applies
any outstanding migrations sequentially.  Each migration is a simple
SQL string executed inside a transaction.

Usage:
    await check_migrations(db_path)
"""

import logging
import aiosqlite

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Migration definitions
# ──────────────────────────────────────────────
# Each entry is (version_number, description, sql_statements).
# sql_statements is a list of individual SQL commands to execute.

MIGRATIONS: list[tuple[int, str, list[str]]] = [
    (
        1,
        "Initial schema — jobs, scrape_log, schema_version tables",
        [
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id                TEXT PRIMARY KEY,
                title             TEXT NOT NULL,
                company           TEXT NOT NULL,
                location          TEXT,
                salary            TEXT DEFAULT 'Not listed',
                url               TEXT,
                source            TEXT,
                snippet           TEXT,
                tags              TEXT,
                status            TEXT DEFAULT 'new',
                is_new            INTEGER DEFAULT 1,
                match_score       INTEGER DEFAULT 0,
                date_found        TEXT,
                date_posted       TEXT,
                last_seen         TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS scrape_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at  TEXT,
                finished_at TEXT,
                jobs_found  INTEGER,
                jobs_new    INTEGER,
                source      TEXT,
                status      TEXT,
                error       TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER
            )
            """,
        ],
    ),
    (
        2,
        "Add scrape_count column to jobs",
        [
            """
            ALTER TABLE jobs ADD COLUMN scrape_count INTEGER DEFAULT 1
            """,
        ],
    ),
    (
        3,
        "Add notified column to jobs",
        [
            """
            ALTER TABLE jobs ADD COLUMN notified INTEGER DEFAULT 0
            """,
        ],
    ),
    (
        4,
        "Add is_active column to jobs",
        [
            """
            ALTER TABLE jobs ADD COLUMN is_active INTEGER DEFAULT 1
            """,
        ],
    ),
    (
        5,
        "Add consecutive_misses column to jobs",
        [
            """
            ALTER TABLE jobs ADD COLUMN consecutive_misses INTEGER DEFAULT 0
            """,
        ],
    ),
    (
        6,
        "Google Sign-In integration — users and user_jobs tables",
        [
            """
            CREATE TABLE IF NOT EXISTS users (
                id          TEXT PRIMARY KEY,
                email       TEXT NOT NULL,
                name        TEXT NOT NULL,
                picture     TEXT,
                created_at  TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_jobs (
                user_id     TEXT NOT NULL,
                job_id      TEXT NOT NULL,
                status      TEXT DEFAULT 'new',
                notified    INTEGER DEFAULT 0,
                updated_at  TEXT NOT NULL,
                PRIMARY KEY (user_id, job_id)
            )
            """,
        ],
    ),
]


async def _table_exists(db: aiosqlite.Connection, table_name: str) -> bool:
    """Check if a table exists in the database."""
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    row = await cursor.fetchone()
    return row is not None


async def _column_exists(db: aiosqlite.Connection, table: str, column: str) -> bool:
    """Check if a column already exists on a table (for safe ALTER TABLE)."""
    cursor = await db.execute(f"PRAGMA table_info({table})")
    rows = await cursor.fetchall()
    existing_columns = {r[1] for r in rows}  # index 1 is the column name
    return column in existing_columns


async def _get_current_version(db: aiosqlite.Connection) -> int:
    """Return the current schema version, or 0 if the table doesn't exist."""
    if not await _table_exists(db, "schema_version"):
        return 0

    cursor = await db.execute("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    row = await cursor.fetchone()
    if row is None:
        return 0
    return int(row[0])


async def _set_version(db: aiosqlite.Connection, version: int) -> None:
    """Upsert the schema version."""
    cursor = await db.execute("SELECT COUNT(*) FROM schema_version")
    count = (await cursor.fetchone())[0]
    if count == 0:
        await db.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
    else:
        await db.execute("UPDATE schema_version SET version = ?", (version,))


async def check_migrations(db_path: str) -> None:
    """Run all outstanding migrations against *db_path*.

    Safe to call on every startup — already-applied migrations are skipped.
    ALTER TABLE operations check for column existence first to be idempotent.
    """
    db = await aiosqlite.connect(db_path)
    try:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=5000")

        current_version = await _get_current_version(db)
        logger.info("Current schema version: %d", current_version)

        applied = 0
        for version, description, statements in MIGRATIONS:
            if version <= current_version:
                continue

            logger.info("Applying migration v%d: %s", version, description)
            for sql in statements:
                sql_stripped = sql.strip().upper()
                # Guard ALTER TABLE ADD COLUMN against duplicate columns
                if sql_stripped.startswith("ALTER TABLE") and "ADD COLUMN" in sql_stripped:
                    # Parse table and column name from the SQL
                    # Expected form: ALTER TABLE <table> ADD COLUMN <col> ...
                    parts = sql.strip().split()
                    try:
                        table_idx = next(
                            i for i, p in enumerate(parts) if p.upper() == "TABLE"
                        )
                        col_idx = next(
                            i for i, p in enumerate(parts) if p.upper() == "COLUMN"
                        )
                        table_name = parts[table_idx + 1]
                        column_name = parts[col_idx + 1]
                        if await _column_exists(db, table_name, column_name):
                            logger.debug(
                                "Column %s.%s already exists, skipping ALTER",
                                table_name,
                                column_name,
                            )
                            continue
                    except (StopIteration, IndexError):
                        pass  # Fall through and let SQLite handle it

                try:
                    await db.execute(sql)
                except Exception as exc:
                    # Tolerate "duplicate column" errors from ALTER TABLE
                    if "duplicate column" in str(exc).lower():
                        logger.debug("Ignoring duplicate column error: %s", exc)
                    else:
                        raise

            await _set_version(db, version)
            await db.commit()
            applied += 1
            logger.info("Migration v%d applied successfully", version)

        if applied == 0:
            logger.info("Schema is up to date (v%d)", current_version)
        else:
            logger.info("Applied %d migration(s), now at v%d", applied, version)
    except Exception:
        logger.exception("Migration failed")
        raise
    finally:
        await db.close()
