from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .db import get_conn, init_db
from .chopper import slice_chop
from .generator import generate, ChopResult
from .indexer import find_media, index_file
from .jobs import JobStatus, create_job, get_job, executor
from .search import find_chop

OUTPUT_DIR = Path.home() / "teseu_out"
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="teseu")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="files")


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

            conn = get_conn()
            init_db(conn)

            for f in files:
                try:
                    def _index(f=f):
                        return index_file(
                            f, wmodel, conn,
                            language=req.language,
                            min_confidence=req.min_confidence,
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
    return {"job_id": job.job_id}


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
            output_dir=OUTPUT_DIR,
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
                "thumbnail_url": f"/files/{c.thumbnail_file}" if c.thumbnail_file else None,
                "margin_ms": 200,
            }
            for c in result.chops
        ],
    }


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
    out_path = OUTPUT_DIR / req.output_file
    if not out_path.exists():
        raise HTTPException(404, f"File not found: {req.output_file}")

    new_start = max(0.0, req.start_sec + req.offset_ms / 1000)
    new_end = max(new_start + 0.05, req.end_sec + req.offset_ms / 1000)

    loop = asyncio.get_event_loop()

    def _regen():
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

    def _join():
        chunks = []
        for fname in req.files:
            p = OUTPUT_DIR / fname
            if p.exists():
                chunks.append(_AS.from_file(str(p)))
        if not chunks:
            raise ValueError("No valid chop files found")
        gap = _AS.silent(duration=req.gap_ms) if req.gap_ms > 0 else _AS.empty()
        result = chunks[0]
        for c in chunks[1:]:
            result = result + gap + c
        result.export(str(OUTPUT_DIR / req.output_file), format="wav")

    await loop.run_in_executor(None, _join)
    return {"url": f"/files/{req.output_file}"}


# ── output dir ───────────────────────────────────────────────────────────────

@app.post("/open_output_dir")
async def open_output_dir():
    import platform, subprocess as sp
    if platform.system() == "Darwin":
        sp.Popen(["open", str(OUTPUT_DIR)])
    elif platform.system() == "Windows":
        sp.Popen(["explorer", str(OUTPUT_DIR)])
    else:
        sp.Popen(["xdg-open", str(OUTPUT_DIR)])
    return {"path": str(OUTPUT_DIR)}


# ── stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
async def stats():
    conn = get_conn()
    init_db(conn)
    file_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    word_count = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    vocab_size = conn.execute("SELECT COUNT(DISTINCT word_normalized) FROM words").fetchone()[0]
    return {"files": file_count, "words": word_count, "vocab": vocab_size}
