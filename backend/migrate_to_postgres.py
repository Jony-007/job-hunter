import os
import sqlite3
import psycopg2
SQLITE_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jobs.db")
POSTGRES_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or "postgresql://user:password@localhost:5432/neondb?sslmode=require"

def migrate():
    print(f"Connecting to SQLite: {SQLITE_DB}")
    if not os.path.exists(SQLITE_DB):
        print("SQLite jobs.db file not found! Nothing to migrate.")
        return
    
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    sqlite_cur = sqlite_conn.cursor()
    
    print(f"Connecting to Neon Postgres...")
    pg_conn = psycopg2.connect(POSTGRES_URL)
    pg_cur = pg_conn.cursor()
    
    # ── Create Schemas if not exists ──
    print("Initializing Postgres schemas...")
    pg_cur.execute("""
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
            id          TEXT PRIMARY KEY,
            email       TEXT NOT NULL,
            name        TEXT NOT NULL,
            picture     TEXT,
            created_at  TEXT
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
    """)
    pg_conn.commit()
    
    # ── Migrate Schema Version ──
    try:
        sqlite_cur.execute("SELECT version FROM schema_version LIMIT 1")
        v_row = sqlite_cur.fetchone()
        if v_row:
            version = v_row[0]
            pg_cur.execute("SELECT COUNT(*) FROM schema_version")
            if pg_cur.fetchone()[0] == 0:
                pg_cur.execute("INSERT INTO schema_version (version) VALUES (%s)", (version,))
                print(f"Migrated schema version: {version}")
    except Exception as e:
        print(f"Skipping schema_version migration: {e}")
        
    # ── Migrate Users ──
    try:
        sqlite_cur.execute("SELECT id, email, name, picture, created_at FROM users")
        user_rows = sqlite_cur.fetchall()
        print(f"Found {len(user_rows)} users in SQLite...")
        migrated_users = 0
        for row in user_rows:
            pg_cur.execute("""
                INSERT INTO users (id, email, name, picture, created_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, row)
            migrated_users += 1
        print(f"Successfully migrated {migrated_users} users.")
    except Exception as e:
        print(f"Error migrating users: {e}")
        
    # ── Migrate Jobs ──
    try:
        sqlite_cur.execute("""
            SELECT id, title, company, location, salary, url, source, snippet, tags, status,
                   is_new, is_active, match_score, scrape_count, consecutive_misses, notified,
                   date_found, date_posted, last_seen
            FROM jobs
        """)
        job_rows = sqlite_cur.fetchall()
        print(f"Found {len(job_rows)} jobs in SQLite...")
        migrated_jobs = 0
        for row in job_rows:
            pg_cur.execute("""
                INSERT INTO jobs (
                    id, title, company, location, salary, url, source, snippet, tags, status,
                    is_new, is_active, match_score, scrape_count, consecutive_misses, notified,
                    date_found, date_posted, last_seen
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s
                )
                ON CONFLICT (id) DO NOTHING
            """, row)
            migrated_jobs += 1
        print(f"Successfully migrated {migrated_jobs} jobs.")
    except Exception as e:
        print(f"Error migrating jobs: {e}")
        
    # ── Migrate User Jobs ──
    try:
        sqlite_cur.execute("SELECT user_id, job_id, status, notified, updated_at FROM user_jobs")
        uj_rows = sqlite_cur.fetchall()
        print(f"Found {len(uj_rows)} user status overrides in SQLite...")
        migrated_uj = 0
        for row in uj_rows:
            pg_cur.execute("""
                INSERT INTO user_jobs (user_id, job_id, status, notified, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, job_id) DO NOTHING
            """, row)
            migrated_uj += 1
        print(f"Successfully migrated {migrated_uj} user status overrides.")
    except Exception as e:
        print(f"Error migrating user_jobs: {e}")
        
    # ── Migrate Scrape Logs ──
    try:
        sqlite_cur.execute("SELECT started_at, finished_at, jobs_found, jobs_new, source, status, error FROM scrape_log")
        log_rows = sqlite_cur.fetchall()
        print(f"Found {len(log_rows)} scrape log entries in SQLite...")
        migrated_logs = 0
        for row in log_rows:
            pg_cur.execute("""
                INSERT INTO scrape_log (started_at, finished_at, jobs_found, jobs_new, source, status, error)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, row)
            migrated_logs += 1
        print(f"Successfully migrated {migrated_logs} scrape log entries.")
    except Exception as e:
        print(f"Error migrating scrape logs: {e}")
        
    pg_conn.commit()
    pg_cur.close()
    pg_conn.close()
    sqlite_cur.close()
    sqlite_conn.close()
    print("Migration successfully completed!")

if __name__ == "__main__":
    migrate()
