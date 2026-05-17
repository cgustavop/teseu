import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".teseu" / "index.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS folders (
            id       INTEGER PRIMARY KEY,
            path     TEXT UNIQUE NOT NULL,
            enabled  INTEGER NOT NULL DEFAULT 1,
            added_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS files (
            id           INTEGER PRIMARY KEY,
            path         TEXT UNIQUE NOT NULL,
            duration_sec REAL,
            indexed_at   TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS words (
            id              INTEGER PRIMARY KEY,
            file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            word            TEXT NOT NULL,
            word_normalized TEXT NOT NULL,
            start_sec       REAL NOT NULL,
            end_sec         REAL NOT NULL,
            probability     REAL NOT NULL DEFAULT 1.0
        );
        CREATE INDEX IF NOT EXISTS idx_words_normalized ON words(word_normalized);
        CREATE INDEX IF NOT EXISTS idx_words_file       ON words(file_id);
    """)
    # migrations — silent if column already exists
    for stmt in [
        "ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL",
    ]:
        try:
            conn.execute(stmt)
        except Exception:
            pass
    conn.commit()
