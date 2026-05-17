import random
import re
import sqlite3
from typing import Optional

from rapidfuzz import fuzz, process

_FOLDER_JOIN = (
    "JOIN files f ON w.file_id = f.id "
    "LEFT JOIN folders fo ON f.folder_id = fo.id "
)
_FOLDER_FILTER = "AND (fo.enabled = 1 OR fo.id IS NULL)"


def _norm(word: str) -> str:
    return re.sub(r'[^a-z0-9]', '', word.lower())


def find_chop(word: str, conn: sqlite3.Connection, threshold: int = 80) -> Optional[dict]:
    normalized = _norm(word)

    rows = conn.execute(
        f"SELECT w.word, w.start_sec, w.end_sec, f.path "
        f"FROM words w {_FOLDER_JOIN}"
        f"WHERE w.word_normalized = ? {_FOLDER_FILTER}",
        (normalized,)
    ).fetchall()

    if rows:
        return dict(random.choice(rows))

    vocab = [r[0] for r in conn.execute(
        f"SELECT DISTINCT w.word_normalized FROM words w {_FOLDER_JOIN}"
        f"WHERE 1=1 {_FOLDER_FILTER}"
    ).fetchall()]

    if not vocab:
        return None

    results = process.extract(normalized, vocab, scorer=fuzz.ratio, limit=10)
    good = [(w, s) for w, s, _ in results if s >= threshold]
    if not good:
        return None

    best = good[0][1]
    candidates = [w for w, s in good if s >= best - 5]
    chosen = random.choice(candidates)

    rows = conn.execute(
        f"SELECT w.word, w.start_sec, w.end_sec, f.path "
        f"FROM words w {_FOLDER_JOIN}"
        f"WHERE w.word_normalized = ? {_FOLDER_FILTER}",
        (chosen,)
    ).fetchall()

    return dict(random.choice(rows)) if rows else None
