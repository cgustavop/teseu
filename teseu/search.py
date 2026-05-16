import random
import re
import sqlite3
from typing import Optional

from rapidfuzz import fuzz, process


def _norm(word: str) -> str:
    return re.sub(r'[^a-z0-9]', '', word.lower())


def find_chop(word: str, conn: sqlite3.Connection, threshold: int = 80) -> Optional[dict]:
    normalized = _norm(word)

    rows = conn.execute(
        "SELECT w.word, w.start_sec, w.end_sec, f.path "
        "FROM words w JOIN files f ON w.file_id = f.id "
        "WHERE w.word_normalized = ?",
        (normalized,)
    ).fetchall()

    if rows:
        return dict(random.choice(rows))

    vocab = [r[0] for r in conn.execute(
        "SELECT DISTINCT word_normalized FROM words"
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
        "SELECT w.word, w.start_sec, w.end_sec, f.path "
        "FROM words w JOIN files f ON w.file_id = f.id "
        "WHERE w.word_normalized = ?",
        (chosen,)
    ).fetchall()

    return dict(random.choice(rows)) if rows else None
