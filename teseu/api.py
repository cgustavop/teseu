from __future__ import annotations

import asyncio
import json
import platform
import subprocess as sp
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .db import get_conn, init_db
from .chopper import slice_chop
from .generator import generate, ChopResult
from .indexer import find_media, index_file
from .jobs import JobStatus, create_job, get_job, executor
from .search import find_chop

_output_dir: Path = Path.home() / "teseu_out"


def _pick_folder_dialog(title: str = "Select folder") -> str:
    """Cross-platform folder picker using tkinter."""
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.wm_attributes("-topmost", True)
    path = filedialog.askdirectory(title=title)
    root.destroy()
    return path or ""


def _open_path(path: Path) -> None:
    """Open a folder in the native file manager, cross-platform."""
    sys = platform.system()
    if sys == "Windows":
        import os
        os.startfile(str(path))
    elif sys == "Darwin":
        sp.Popen(["open", str(path)])
    else:
        sp.Popen(["xdg-open", str(path)])
_output_dir.mkdir(exist_ok=True)

app = FastAPI(title="teseu")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/files/{filename:path}")
async def serve_file(filename: str):
    from fastapi.responses import FileResponse
    p = _output_dir / filename
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(p))


# ── index ─────────────────────────────────────────────────────────────────────

class IndexRequest(BaseModel):
    folder: str
    model: str = "base"
    language: Optional[str] = None
    min_confidence: float = 0.75


@app.post("/index")
async def start_index(req: IndexRequest):
    folder = Path(req.folder)
    if not folder.exists():
        raise HTTPException(400, f"Folder not found: {req.folder}")

    # register folder (upsert — don't overwrite enabled state)
    conn = get_conn()
    init_db(conn)
    conn.execute("INSERT OR IGNORE INTO folders (path) VALUES (?)", (str(folder.resolve()),))
    conn.commit()
    folder_row = conn.execute("SELECT id FROM folders WHERE path = ?", (str(folder.resolve()),)).fetchone()
    folder_id = folder_row["id"]

    # backfill existing files that belong to this folder but were indexed before folder tracking
    conn.execute(
        "UPDATE files SET folder_id = ? WHERE folder_id IS NULL AND path LIKE ?",
        (folder_id, str(folder.resolve()) + "%"),
    )
    conn.commit()

    job = create_job()

    async def run():
        import whisper as _whisper
        loop = asyncio.get_event_loop()
        job.status = JobStatus.RUNNING

        try:
            wmodel = await loop.run_in_executor(executor, _whisper.load_model, req.model)
            files = list(find_media(folder))
            job.total = len(files)
            await job.queue.put({"type": "start", "total": len(files)})

            for f in files:
                try:
                    def _index(f=f, fid=folder_id):
                        c = get_conn()
                        return index_file(
                            f, wmodel, c,
                            language=req.language,
                            min_confidence=req.min_confidence,
                            folder_id=fid,
                        )
                    result = await loop.run_in_executor(executor, _index)
                    job.done += 1

                    if result is False:
                        msg = {"type": "progress", "file": f.name, "done": job.done,
                               "total": job.total, "status": "skipped"}
                    else:
                        n_words, n_low = result
                        job.low_conf += n_low
                        msg = {"type": "progress", "file": f.name, "done": job.done,
                               "total": job.total, "status": "ok",
                               "words": n_words, "low_conf": n_low}

                    await job.queue.put(msg)

                except Exception as e:
                    job.errors += 1
                    job.done += 1
                    await job.queue.put({"type": "progress", "file": f.name,
                                         "done": job.done, "total": job.total,
                                         "status": "error", "error": str(e)})

            job.status = JobStatus.DONE
            await job.queue.put({"type": "done", "total": job.total,
                                  "errors": job.errors, "low_conf": job.low_conf})

        except Exception as e:
            job.status = JobStatus.ERROR
            await job.queue.put({"type": "error", "message": str(e)})

    asyncio.create_task(run())
    return {"job_id": job.job_id, "folder_id": folder_id}


# ── folders ────────────────────────────────────────────────────────────────────

@app.get("/folders")
async def list_folders():
    conn = get_conn()
    init_db(conn)
    rows = conn.execute("""
        SELECT fo.id, fo.path, fo.enabled,
               COUNT(DISTINCT f.id) AS file_count,
               COUNT(w.id)          AS word_count
        FROM folders fo
        LEFT JOIN files f ON f.folder_id = fo.id
        LEFT JOIN words w ON w.file_id = f.id
        GROUP BY fo.id
        ORDER BY fo.added_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


class FolderPatch(BaseModel):
    enabled: bool


@app.patch("/folders/{folder_id}")
async def patch_folder(folder_id: int, body: FolderPatch):
    conn = get_conn()
    init_db(conn)
    conn.execute("UPDATE folders SET enabled = ? WHERE id = ?",
                 (1 if body.enabled else 0, folder_id))
    conn.commit()
    return {"ok": True}


@app.delete("/folders/{folder_id}")
async def delete_folder(folder_id: int):
    conn = get_conn()
    init_db(conn)
    conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    conn.commit()
    return {"ok": True}


@app.post("/folders/update")
async def update_folders():
    """Re-index enabled folders — only files not yet in DB."""
    conn = get_conn()
    init_db(conn)
    folders = conn.execute("SELECT id, path FROM folders WHERE enabled = 1").fetchall()

    # backfill any existing files not yet linked to a folder
    for row in folders:
        conn.execute(
            "UPDATE files SET folder_id = ? WHERE folder_id IS NULL AND path LIKE ?",
            (row["id"], row["path"] + "%"),
        )
    conn.commit()

    new_files: list[tuple] = []
    for row in folders:
        p = Path(row["path"])
        if not p.exists():
            continue
        for f in find_media(p):
            exists = conn.execute("SELECT id FROM files WHERE path = ?",
                                  (str(f.resolve()),)).fetchone()
            if not exists:
                new_files.append((f, row["id"]))

    job = create_job()

    async def run():
        import whisper as _whisper
        loop = asyncio.get_event_loop()
        job.status = JobStatus.RUNNING
        try:
            wmodel = await loop.run_in_executor(executor, _whisper.load_model, "base")
            job.total = len(new_files)
            await job.queue.put({"type": "start", "total": len(new_files)})
            for f, fid in new_files:
                try:
                    def _idx(f=f, fid=fid):
                        return index_file(f, wmodel, get_conn(), folder_id=fid)
                    result = await loop.run_in_executor(executor, _idx)
                    job.done += 1
                    status = "skipped" if result is False else "ok"
                    if result and result is not False:
                        job.low_conf += result[1]
                    await job.queue.put({"type": "progress", "file": f.name,
                                          "done": job.done, "total": job.total, "status": status})
                except Exception as e:
                    job.errors += 1
                    job.done += 1
                    await job.queue.put({"type": "progress", "file": f.name,
                                          "done": job.done, "total": job.total,
                                          "status": "error", "error": str(e)})
            job.status = JobStatus.DONE
            await job.queue.put({"type": "done", "total": job.total, "errors": job.errors})
        except Exception as e:
            job.status = JobStatus.ERROR
            await job.queue.put({"type": "error", "message": str(e)})

    asyncio.create_task(run())
    return {"job_id": job.job_id, "new_files": len(new_files)}


@app.get("/random_words")
async def random_words_endpoint(count: int = 6):
    conn = get_conn()
    init_db(conn)
    rows = conn.execute("""
        SELECT DISTINCT w.word FROM words w
        JOIN files f ON w.file_id = f.id
        LEFT JOIN folders fo ON f.folder_id = fo.id
        WHERE fo.enabled = 1 OR fo.id IS NULL
        ORDER BY RANDOM()
        LIMIT ?
    """, (count,)).fetchall()
    return {"words": [r["word"] for r in rows]}


@app.get("/index/stream/{job_id}")
async def index_stream(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    async def event_gen():
        while True:
            msg = await job.queue.get()
            yield {"data": json.dumps(msg)}
            if msg.get("type") in ("done", "error"):
                break

    return EventSourceResponse(event_gen())


@app.get("/index/status/{job_id}")
async def index_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "status": job.status,
        "done": job.done,
        "total": job.total,
        "errors": job.errors,
        "low_conf": job.low_conf,
    }


# ── generate ──────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    phrase: str
    sample_rate: int = 44100
    normalize_lufs: float = -16.0
    gap_ms: int = 0
    fade_in_ms: int = 5
    fade_out_ms: int = 15
    onset_search_ms: int = 100
    onset_threshold_db: float = -35.0
    use_onset: bool = False  # default off for speed in UI
    tail_buffer_ms: int = 30
    match_threshold: int = 80
    concat: bool = True
    individual: bool = False
    video: bool = False


@app.post("/generate")
async def run_generate(req: GenerateRequest):
    loop = asyncio.get_event_loop()

    def _gen():
        return generate(
            phrase=req.phrase,
            output_dir=_output_dir,
            sample_rate=req.sample_rate,
            normalize_lufs=req.normalize_lufs,
            gap_ms=req.gap_ms,
            fade_in_ms=req.fade_in_ms,
            fade_out_ms=req.fade_out_ms,
            onset_search_ms=req.onset_search_ms,
            onset_threshold_db=req.onset_threshold_db,
            use_onset=req.use_onset,
            tail_buffer_ms=req.tail_buffer_ms,
            match_threshold=req.match_threshold,
            concat=req.concat,
            individual=req.individual,
            video=req.video,
        )

    result = await loop.run_in_executor(None, _gen)

    return {
        "phrase_slug": result.phrase_slug,
        "joined_file": result.joined_file,
        "joined_url": f"/files/{result.joined_file}" if result.joined_file else None,
        "chops": [
            {
                "index": c.index,
                "word": c.word,
                "matched_word": c.matched_word,
                "source_path": c.source_path,
                "start_sec": c.start_sec,
                "end_sec": c.end_sec,
                "is_tts": c.is_tts,
                "output_file": c.output_file,
                "url": f"/files/{c.output_file}" if c.output_file else None,
                "output_path": str(_output_dir / c.output_file) if c.output_file else None,
                "thumbnail_file": c.thumbnail_file,
                "thumbnail_url": f"/files/{c.thumbnail_file}" if c.thumbnail_file else None,
                "margin_ms": 200,
            }
            for c in result.chops
        ],
    }


# ── word helpers ─────────────────────────────────────────────────────────────

@app.post("/check_words")
async def check_words(words: list[str]):
    import re as _re
    conn = get_conn()
    init_db(conn)
    result: dict[str, bool] = {}
    for word in words:
        norm = _re.sub(r'[^a-z0-9]', '', word.lower())
        if norm:
            row = conn.execute(
                "SELECT 1 FROM words w "
                "JOIN files f ON w.file_id = f.id "
                "LEFT JOIN folders fo ON f.folder_id = fo.id "
                "WHERE w.word_normalized = ? "
                "AND (fo.enabled = 1 OR fo.id IS NULL) LIMIT 1", (norm,)
            ).fetchone()
            result[word.lower()] = row is not None
        else:
            result[word.lower()] = False
    return result


@app.get("/suggest/{partial}")
async def suggest(partial: str, limit: int = 6):
    import re as _re
    conn = get_conn()
    init_db(conn)
    norm = _re.sub(r'[^a-z0-9]', '', partial.lower())
    if not norm:
        return {"words": []}
    rows = conn.execute(
        "SELECT DISTINCT w.word FROM words w "
        "JOIN files f ON w.file_id = f.id "
        "LEFT JOIN folders fo ON f.folder_id = fo.id "
        "WHERE w.word_normalized LIKE ? "
        "AND (fo.enabled = 1 OR fo.id IS NULL) "
        "ORDER BY w.word LIMIT ?",
        (norm + "%", limit),
    ).fetchall()
    return {"words": [r["word"] for r in rows]}


# ── candidates ────────────────────────────────────────────────────────────────

@app.get("/candidates/{word}")
async def candidates(word: str, threshold: int = 80, limit: int = 10):
    conn = get_conn()
    init_db(conn)

    from rapidfuzz import fuzz, process
    import re

    normalized = re.sub(r'[^a-z0-9]', '', word.lower())
    vocab = [r[0] for r in conn.execute(
        "SELECT DISTINCT word_normalized FROM words"
    ).fetchall()]

    results = process.extract(normalized, vocab, scorer=fuzz.ratio, limit=limit)
    matches = []
    for w_norm, score, _ in results:
        if score < threshold:
            continue
        rows = conn.execute(
            "SELECT w.word, w.start_sec, w.end_sec, w.probability, f.path "
            "FROM words w JOIN files f ON w.file_id = f.id "
            "WHERE w.word_normalized = ? LIMIT 5",
            (w_norm,)
        ).fetchall()
        for r in rows:
            matches.append({
                "word": r["word"],
                "score": score,
                "probability": r["probability"],
                "start_sec": r["start_sec"],
                "end_sec": r["end_sec"],
                "source": Path(r["path"]).name,
                "source_path": r["path"],
            })

    return {"word": word, "matches": matches}


# ── stats ─────────────────────────────────────────────────────────────────────

class RegenerateChopRequest(BaseModel):
    output_file: str
    source_path: str
    start_sec: float
    end_sec: float
    offset_ms: float
    sample_rate: int = 44100
    normalize_lufs: float = -16.0
    fade_in_ms: int = 5
    fade_out_ms: int = 15
    onset_search_ms: int = 100
    onset_threshold_db: float = -35.0
    use_onset: bool = False
    tail_buffer_ms: int = 30


@app.post("/regenerate_chop")
async def run_regenerate_chop(req: RegenerateChopRequest):
    out_path = _output_dir / req.output_file
    if not out_path.exists():
        raise HTTPException(404, f"File not found: {req.output_file}")

    new_start = max(0.0, req.start_sec + req.offset_ms / 1000)
    new_end = max(new_start + 0.05, req.end_sec + req.offset_ms / 1000)

    loop = asyncio.get_event_loop()

    is_video_out = req.output_file.endswith('.mp4')

    def _regen():
        if is_video_out:
            from .chopper import slice_video_clip, VIDEO_EXTS
            if Path(req.source_path).suffix.lower() not in VIDEO_EXTS:
                raise ValueError("Source is not a video file")
            slice_video_clip(req.source_path, new_start, new_end, out_path)
        else:
            chunk = slice_chop(
                req.source_path, new_start, new_end, req.sample_rate,
                normalize_lufs=req.normalize_lufs if req.normalize_lufs != 0 else None,
                fade_in_ms=req.fade_in_ms,
                fade_out_ms=req.fade_out_ms,
                onset_search_ms=req.onset_search_ms,
                onset_threshold_db=req.onset_threshold_db,
                use_onset=req.use_onset,
                tail_buffer_ms=req.tail_buffer_ms,
            )
            chunk.export(str(out_path), format='wav')

    await loop.run_in_executor(None, _regen)
    return {"url": f"/files/{req.output_file}", "start_sec": new_start, "end_sec": new_end}


# ── join chops ────────────────────────────────────────────────────────────────

class JoinRequest(BaseModel):
    files: list[str]
    gap_ms: int = 0
    output_file: str


@app.post("/join_chops")
async def join_chops_api(req: JoinRequest):
    from pydub import AudioSegment as _AS

    loop = asyncio.get_event_loop()

    is_video_join = req.output_file.endswith('.mp4')

    def _join():
        valid = [_output_dir / f for f in req.files if (_output_dir / f).exists()]
        if not valid:
            raise ValueError("No valid chop files found")
        if is_video_join:
            from .chopper import concat_video_clips
            concat_video_clips(valid, _output_dir / req.output_file)
        else:
            chunks = [_AS.from_file(str(p)) for p in valid]
            gap = _AS.silent(duration=req.gap_ms) if req.gap_ms > 0 else _AS.empty()
            result = chunks[0]
            for c in chunks[1:]:
                result = result + gap + c
            result.export(str(_output_dir / req.output_file), format="wav")

    await loop.run_in_executor(None, _join)
    return {"url": f"/files/{req.output_file}"}


# ── output dir ───────────────────────────────────────────────────────────────

@app.get("/pick_folder")
async def pick_folder():
    try:
        path = await asyncio.to_thread(_pick_folder_dialog, "Select media folder")
    except Exception as e:
        raise HTTPException(500, str(e))
    if not path:
        raise HTTPException(400, "No folder selected")
    return {"path": path}


@app.post("/open_output_dir")
async def open_output_dir():
    _output_dir.mkdir(parents=True, exist_ok=True)
    _open_path(_output_dir)
    return {"path": str(_output_dir)}


class CopyRequest(BaseModel):
    files: list[str]  # relative filenames under output dir


@app.post("/copy_to_clipboard")
async def copy_to_clipboard(req: CopyRequest):
    import platform, subprocess as sp
    sys = platform.system()
    paths = [str(_output_dir / f) for f in req.files if (_output_dir / f).exists()]
    if not paths:
        raise HTTPException(404, "No files found")

    if sys == "Darwin":
        items = ", ".join(f'POSIX file "{p}"' for p in paths)
        script = f"set the clipboard to {{{items}}}" if len(paths) > 1 else f'set the clipboard to POSIX file "{paths[0]}"'
        sp.run(["osascript", "-e", script], check=True)
    elif sys == "Windows":
        adds = "\n".join(f'$files.Add("{p}") | Out-Null' for p in paths)
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms;\n"
            "$files = New-Object System.Collections.Specialized.StringCollection;\n"
            f"{adds}\n"
            "[System.Windows.Forms.Clipboard]::SetFileDropList($files);"
        )
        sp.run(["powershell", "-Command", ps], check=True)
    else:
        raise HTTPException(501, "Clipboard copy not supported on this platform")

    return {"ok": True, "count": len(paths)}


class ExportRequest(BaseModel):
    files: list[str]  # relative filenames under output dir


@app.post("/export_session")
async def export_session_endpoint(req: ExportRequest):
    global _output_dir
    import shutil
    try:
        path = await asyncio.to_thread(_pick_folder_dialog, "Save session to…")
    except Exception as e:
        raise HTTPException(500, str(e))

    if not path:
        raise HTTPException(400, "No folder selected")

    dest_dir = Path(path)
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = []
    for f in req.files:
        src = _output_dir / f
        if src.exists():
            shutil.copy2(str(src), str(dest_dir / src.name))
            copied.append(src.name)

    _output_dir = dest_dir
    return {"path": str(dest_dir), "copied": len(copied)}


# ── stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
async def stats():
    conn = get_conn()
    init_db(conn)
    file_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    word_count = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    vocab_size = conn.execute("SELECT COUNT(DISTINCT word_normalized) FROM words").fetchone()[0]
    return {"files": file_count, "words": word_count, "vocab": vocab_size}
