# teseu

Cut words and phrases from your audio/video library and stitch them into new audio. Transcribes media with Whisper, stores a searchable word index, then chops and joins clips on demand.

Works as a **desktop UI** (browser + local server) or a **CLI**.

---

## Prerequisites

### Both platforms

| Requirement | Version | Notes |
|---|---|---|
| Python | ≥ 3.10 | |
| Node.js + npm | ≥ 18 | UI only |
| ffmpeg | any recent | must be on `PATH` |

### macOS

```bash
brew install python ffmpeg node
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv ffmpeg nodejs npm
```

---

## Install

```bash
git clone <repo-url>
cd teseu

# create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# install Python package
pip install -e .
pip install -r requirements.txt

# install UI dependencies
cd ui && npm install && cd ..
```

---

## Running the UI

Open two terminals (both with the venv active):

**Terminal 1 — backend**
```bash
source .venv/bin/activate
uvicorn teseu.api:app --reload --port 8000
```

**Terminal 2 — frontend**
```bash
cd ui
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## UI walkthrough

1. **Import folder** — click "Import folder…" and pick a directory with audio/video files. Teseu transcribes every file with Whisper and builds a word index. This only runs once per file; re-indexing is skipped automatically.

2. **Compose** — type a phrase in the text box. Each word is matched against the index using fuzzy search.

3. **Generate** — click **Play**. Teseu chops the matched words from their source files and joins them into a single output.

4. **Preview** — the result plays inline. Individual word clips are listed below.

5. **Destination** — click the path text to choose a different output folder via Finder/Explorer. Click the folder icon to open the current output folder.

6. **Settings** — tune audio quality, onset detection, fade times, and video output before or after generating.

---

## CLI

The CLI mirrors every feature the UI exposes.

### Index a folder

```bash
teseu index /path/to/media
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--model` | `base` | Whisper model: `tiny` `base` `small` `medium` `large` |
| `--language` | auto | Force language code (`pt`, `en`, `es`, …) |
| `--min-confidence` | `0.75` | Drop words below this Whisper probability |

Example — index in Portuguese with a larger model:
```bash
teseu index ./recordings --model small --language pt
```

### Generate a phrase

```bash
teseu gen "hello world"
```

Or omit the subcommand (shorthand):
```bash
teseu "hello world"
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--output` | `./teseu_out` | Output folder |
| `--match-threshold` | `80` | Fuzzy match score 0–100 |
| `--gap-ms` | `0` | Silence between words in joined file (ms) |
| `--fade-in-ms` | `5` | Fade-in on each chop (ms) |
| `--fade-out-ms` | `15` | Fade-out on each chop (ms) |
| `--normalize-lufs` | `-16.0` | Target loudness (LUFS). `0` to skip |
| `--onset` / `--no-onset` | on | Use onset detection for tighter cuts |
| `--onset-search-ms` | `100` | Search window around Whisper timestamp (ms) |
| `--onset-threshold-db` | `-35` | Energy gate for release detection (dB) |
| `--concat` / `--no-concat` | on | Write joined output file |
| `--individual` / `--no-individual` | on | Write per-word files |
| `--video` | off | Output MP4 instead of WAV |

Examples:

```bash
# tight cuts, no per-word files
teseu gen "good morning" --no-individual --gap-ms 80

# video output, looser match
teseu gen "breaking news" --video --match-threshold 60

# high-quality model, custom output path
teseu index ./media --model medium
teseu gen "the quick brown fox" --output ./out --normalize-lufs -14
```

---

## Supported formats

**Audio:** `.wav` `.mp3` `.flac` `.ogg` `.m4a` `.aac` `.opus` `.wma`

**Video:** `.mp4` `.mkv` `.mov` `.avi` `.webm` `.m4v` `.wmv`

---

## Output

All files land in the output folder (`~/teseu_out` by default):

- `<phrase>.wav` — joined clip
- `<word>_<n>.wav` — individual word chops
- `*.mp4` — video variants (when `--video` is set)
