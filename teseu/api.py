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
            })

    return {"word": word, "matches": matches}


# ── stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
async def stats():
    conn = get_conn()
    init_db(conn)
    file_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    word_count = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    vocab_size = conn.execute("SELECT COUNT(DISTINCT word_normalized) FROM words").fetchone()[0]
    return {"files": file_count, "words": word_count, "vocab": vocab_size}
