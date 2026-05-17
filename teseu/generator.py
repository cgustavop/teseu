from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .chopper import (
    VIDEO_EXTS,
    apply_lufs,
    concat_video_clips,
    extract_thumbnail,
    join_chops,
    make_subtitle_clip,
    slice_chop,
    slice_video_clip,
    tts_placeholder,
)
from .db import get_conn, init_db
from .search import find_chop


@dataclass
class ChopResult:
    index: int
    word: str
    matched_word: Optional[str]
    source_path: Optional[str]
    start_sec: Optional[float]
    end_sec: Optional[float]
    is_tts: bool
    output_file: Optional[str]  # filename only, relative to output_dir
    thumbnail_file: Optional[str] = None  # filename only, relative to output_dir


@dataclass
class GenerateResult:
    chops: list[ChopResult]
    joined_file: Optional[str]  # filename only, relative to output_dir
    output_dir: str
    phrase_slug: str


def _slug(phrase: str, max_len: int = 40) -> str:
    s = re.sub(r'[^\w\s]', '', phrase.lower())
    s = re.sub(r'\s+', '_', s.strip())
    return s[:max_len].rstrip('_')


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem, suffix, parent = path.stem, path.suffix, path.parent
    i = 1
    while True:
        c = parent / f"{stem}_{i}{suffix}"
        if not c.exists():
            return c
        i += 1


def generate(
    phrase: str,
    output_dir: Path,
    sample_rate: int = 44100,
    normalize_lufs: float = -16.0,
    gap_ms: int = 0,
    fade_in_ms: int = 5,
    fade_out_ms: int = 15,
    onset_search_ms: int = 100,
    onset_threshold_db: float = -35.0,
    use_onset: bool = True,
    tail_buffer_ms: int = 30,
    match_threshold: int = 80,
    concat: bool = True,
    individual: bool = True,
    video: bool = False,
    progress: Optional[Callable[[int, int, str], None]] = None,
) -> GenerateResult:
    """
    Core generate logic. `progress(current, total, message)` is called per word.
    Returns structured result — no side effects beyond writing output files.
    """
    conn = get_conn()
    init_db(conn)

    words = phrase.split()
    output_dir.mkdir(parents=True, exist_ok=True)
    lufs_target = normalize_lufs if normalize_lufs != 0 else None

    audio_chunks = []
    video_clips: list[Path] = []
    chop_results: list[ChopResult] = []

    for i, word in enumerate(words, 1):
        safe = re.sub(r'[^\w\-]', '_', ' '.join(word.split()))
        stem = f"{i:02d}_{safe}"
        match = find_chop(word, conn, threshold=match_threshold)

        if match:
            src = match['path']
            t0, t1 = match['start_sec'], match['end_sec']
            msg = f"'{word}' → '{match['word']}' {Path(src).name} [{t0:.2f}s-{t1:.2f}s]"
            if progress:
                progress(i, len(words), msg)
            chunk = slice_chop(
                src, t0, t1, sample_rate,
                normalize_lufs=lufs_target,
                fade_in_ms=fade_in_ms,
                fade_out_ms=fade_out_ms,
                onset_search_ms=onset_search_ms,
                onset_threshold_db=onset_threshold_db,
                use_onset=use_onset,
                tail_buffer_ms=tail_buffer_ms,
            )
            is_video_src = Path(src).suffix.lower() in VIDEO_EXTS
            cr = ChopResult(i, word, match['word'], src, t0, t1, False, None)
        else:
            msg = f"'{word}' → TTS placeholder"
            if progress:
                progress(i, len(words), msg)
            chunk = tts_placeholder(word, sample_rate)
            if lufs_target is not None:
                chunk = apply_lufs(chunk, lufs_target)
            src = None
            is_video_src = False
            cr = ChopResult(i, word, None, None, None, None, True, None)

        audio_chunks.append(chunk)

        if individual:
            wav_path = output_dir / f"{stem}.wav"
            chunk.export(str(wav_path), format='wav')
            cr.output_file = wav_path.name
            if video:
                clip_path = output_dir / f"{stem}.mp4"
                if is_video_src:
                    slice_video_clip(src, t0, t1, clip_path)
                else:
                    make_subtitle_clip(word, chunk, clip_path)
                video_clips.append(clip_path)
        elif video:
            tmp_clip = output_dir / f".tmp_{stem}.mp4"
            if is_video_src:
                slice_video_clip(src, t0, t1, tmp_clip)
            else:
                make_subtitle_clip(word, chunk, tmp_clip)
            video_clips.append(tmp_clip)

        if is_video_src and src:
            thumb_path = output_dir / f"{stem}_thumb.jpg"
            try:
                extract_thumbnail(src, t0, thumb_path)
                cr.thumbnail_file = thumb_path.name
            except Exception:
                pass

        chop_results.append(cr)

    slug = _slug(phrase)
    joined_file: Optional[str] = None

    if concat:
        if audio_chunks:
            joined = join_chops(audio_chunks, gap_ms)
            p = _unique_path(output_dir / f"{slug}.wav")
            joined.export(str(p), format='wav')
            joined_file = p.name
        if video and video_clips:
            p = _unique_path(output_dir / f"{slug}.mp4")
            concat_video_clips(video_clips, p)
            joined_file = p.name

    if not individual and video:
        for p in video_clips:
            p.unlink(missing_ok=True)

    return GenerateResult(
        chops=chop_results,
        joined_file=joined_file,
        output_dir=str(output_dir.resolve()),
        phrase_slug=slug,
    )
