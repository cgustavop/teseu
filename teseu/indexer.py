import re
import subprocess
import tempfile
from pathlib import Path
from typing import Generator

import whisper

AUDIO_EXTS = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma'}
VIDEO_EXTS = {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv'}
ALL_EXTS = AUDIO_EXTS | VIDEO_EXTS


def find_media(folder: Path) -> Generator[Path, None, None]:
    for p in folder.rglob('*'):
        if p.is_file() and p.suffix.lower() in ALL_EXTS:
            yield p


def normalize_word(word: str) -> str:
    return re.sub(r'[^a-z0-9]', '', word.lower())


def _extract_audio(video_path: Path) -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    subprocess.run(
        ['ffmpeg', '-y', '-i', str(video_path),
         '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', tmp.name],
        check=True, capture_output=True
    )
    return Path(tmp.name)


def index_file(path: Path, model, conn, language: str = None, min_confidence: float = 0.75) -> bool:
    cur = conn.execute("SELECT id FROM files WHERE path = ?", (str(path.resolve()),))
    if cur.fetchone():
        return False

    tmp_path = None
    audio_path = path

    try:
        if path.suffix.lower() in VIDEO_EXTS:
            tmp_path = _extract_audio(path)
            audio_path = tmp_path

        result = model.transcribe(str(audio_path), word_timestamps=True, language=language)
        duration = result.get('duration')

        conn.execute(
            "INSERT INTO files (path, duration_sec) VALUES (?, ?)",
            (str(path.resolve()), duration)
        )
        file_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        rows = []
        skipped = 0
        for segment in result['segments']:
            for w in segment.get('words', []):
                prob = w.get('probability', 1.0)
                if prob < min_confidence:
                    skipped += 1
                    continue
                text = ' '.join(w['word'].split())
                norm = normalize_word(text)
                if norm:
                    rows.append((file_id, text, norm, w['start'], w['end'], prob))

        conn.executemany(
            "INSERT INTO words (file_id, word, word_normalized, start_sec, end_sec, probability) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            rows
        )
        conn.commit()
        return len(rows), skipped

    except Exception:
        conn.rollback()
        raise
    finally:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)
