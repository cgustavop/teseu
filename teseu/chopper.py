import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from pydub import AudioSegment

VIDEO_EXTS = {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv'}

VIDEO_SCALE = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2'
VIDEO_FPS = '25'


# ── numpy / AudioSegment converters ──────────────────────────────────────────

def _seg_to_numpy(seg: AudioSegment) -> tuple[np.ndarray, int]:
    samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
    if seg.channels == 2:
        samples = samples.reshape(-1, 2)
    samples /= float(2 ** (seg.sample_width * 8 - 1))
    return samples, seg.frame_rate


def _numpy_to_seg(data: np.ndarray, sr: int) -> AudioSegment:
    data = np.clip(data, -1.0, 1.0)
    channels = data.shape[1] if data.ndim > 1 else 1
    pcm = (data * 32767).astype(np.int16)
    return AudioSegment(
        pcm.tobytes(), frame_rate=sr, sample_width=2, channels=channels
    )


# ── cut helpers ───────────────────────────────────────────────────────────────

def _to_mono(data: np.ndarray) -> np.ndarray:
    return data.mean(axis=1) if data.ndim > 1 else data


def _find_onset(data: np.ndarray, sr: int, whisper_sec: float, search_samples: int) -> int:
    import librosa
    whisper_i = int(whisper_sec * sr)
    win_start = max(0, whisper_i - search_samples)
    win_end = min(len(data), whisper_i + search_samples)

    mono = _to_mono(data[win_start:win_end])
    onsets = librosa.onset.onset_detect(y=mono, sr=sr, backtrack=True, units='samples')

    if len(onsets) == 0:
        return whisper_i

    offset = whisper_i - win_start
    before = onsets[onsets <= offset]
    best = int(before[-1] if len(before) > 0 else onsets[0])
    return win_start + best


def _find_release(
    data: np.ndarray, sr: int, whisper_sec: float,
    search_samples: int, threshold_db: float
) -> int:
    import librosa
    whisper_i = int(whisper_sec * sr)
    win_start = max(0, whisper_i - search_samples)
    win_end = min(len(data), whisper_i + search_samples)

    mono = _to_mono(data[win_start:win_end])
    threshold = 10 ** (threshold_db / 20)
    hop = 256
    rms = librosa.feature.rms(y=mono, frame_length=512, hop_length=hop)[0]
    frame_samples = librosa.frames_to_samples(np.arange(len(rms)), hop_length=hop)

    offset = whisper_i - win_start
    after = np.where(frame_samples >= offset)[0]
    if len(after) == 0:
        return whisper_i

    below = after[rms[after] < threshold]
    if len(below) == 0:
        return whisper_i

    return win_start + int(frame_samples[below[0]])


def _apply_fades(data: np.ndarray, sr: int, fade_in_ms: int, fade_out_ms: int) -> np.ndarray:
    n = len(data)
    result = data.copy()
    fi = min(int(fade_in_ms / 1000 * sr), n // 4)
    fo = min(int(fade_out_ms / 1000 * sr), n // 4)
    if fi > 0:
        ramp = np.linspace(0.0, 1.0, fi, dtype=np.float32)
        result[:fi] *= ramp[:, np.newaxis] if data.ndim > 1 else ramp
    if fo > 0:
        ramp = np.linspace(1.0, 0.0, fo, dtype=np.float32)
        result[-fo:] *= ramp[:, np.newaxis] if data.ndim > 1 else ramp
    return result


def _normalize_lufs(data: np.ndarray, sr: int, target_lufs: float) -> np.ndarray:
    import pyloudnorm as pyln
    meter = pyln.Meter(sr)
    duration = len(data) / sr
    if duration >= 0.4:
        loudness = meter.integrated_loudness(data)
        if np.isfinite(loudness):
            return pyln.normalize.loudness(data, loudness, target_lufs)
    return pyln.normalize.peak(data, -1.0)


# ── public API ────────────────────────────────────────────────────────────────

def _extract_audio_segment(source_path: str, start_sec: float, end_sec: float) -> Path:
    """Extract a time-windowed audio segment from any media file to a temp WAV."""
    pad = 1.0  # extra context for onset/release search
    t_start = max(0.0, start_sec - pad)
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    subprocess.run([
        'ffmpeg', '-y',
        '-ss', str(t_start),
        '-i', source_path,
        '-t', str((end_sec - t_start) + pad),
        '-vn', '-ar', '44100', '-ac', '2', '-f', 'wav', tmp.name,
    ], check=True, capture_output=True)
    return Path(tmp.name), t_start


def slice_chop(
    source_path: str,
    start_sec: float,
    end_sec: float,
    sample_rate: int,
    normalize_lufs: Optional[float] = -16.0,
    fade_in_ms: int = 5,
    fade_out_ms: int = 15,
    onset_search_ms: int = 100,
    onset_threshold_db: float = -35.0,
    use_onset: bool = True,
    tail_buffer_ms: int = 30,
) -> AudioSegment:
    import librosa

    is_video = Path(source_path).suffix.lower() in VIDEO_EXTS
    tmp_wav = None

    if is_video:
        tmp_wav, time_offset = _extract_audio_segment(source_path, start_sec, end_sec)
        audio_path = str(tmp_wav)
        adj_start = start_sec - time_offset
        adj_end = end_sec - time_offset
    else:
        audio_path = source_path
        adj_start = start_sec
        adj_end = end_sec

    try:
        data, sr = sf.read(audio_path, always_2d=True)
        data = data.astype(np.float32)

        tail_samples = int(tail_buffer_ms / 1000 * sr)

        if use_onset:
            word_dur_samples = int((adj_end - adj_start) * sr)
            search = min(int(onset_search_ms / 1000 * sr), max(word_dur_samples // 2, 1))
            start_i = _find_onset(data, sr, adj_start, search)
            end_i = _find_release(data, sr, adj_end, search, onset_threshold_db)
        else:
            start_i = int(adj_start * sr)
            end_i = int(adj_end * sr)

        end_i = min(end_i + tail_samples, len(data))

        chunk = data[start_i:end_i]
        if len(chunk) == 0:
            chunk = data[int(adj_start * sr):int(adj_end * sr)]

        chunk = _apply_fades(chunk, sr, fade_in_ms, fade_out_ms)

        if normalize_lufs is not None:
            chunk = _normalize_lufs(chunk, sr, normalize_lufs)

        if sr != sample_rate:
            chunk = np.stack([
                librosa.resample(chunk[:, c], orig_sr=sr, target_sr=sample_rate)
                for c in range(chunk.shape[1])
            ], axis=1)
            sr = sample_rate

        return _numpy_to_seg(chunk, sr)
    finally:
        if tmp_wav:
            tmp_wav.unlink(missing_ok=True)


def apply_lufs(seg: AudioSegment, target_lufs: float) -> AudioSegment:
    data, sr = _seg_to_numpy(seg)
    normalized = _normalize_lufs(data, sr, target_lufs)
    return _numpy_to_seg(normalized, sr)


def tts_placeholder(word: str, sample_rate: int) -> AudioSegment:
    tmp = tempfile.NamedTemporaryFile(suffix='.aiff', delete=False)
    tmp.close()
    try:
        subprocess.run(['say', '-o', tmp.name, word], check=True, capture_output=True)
        audio = AudioSegment.from_file(tmp.name).set_frame_rate(sample_rate)
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    return audio


def join_chops(chunks: list[AudioSegment], gap_ms: int) -> AudioSegment:
    if not chunks:
        return AudioSegment.empty()
    gap = AudioSegment.silent(duration=gap_ms) if gap_ms > 0 else AudioSegment.empty()
    result = chunks[0]
    for chunk in chunks[1:]:
        result = result + gap + chunk
    return result


def slice_video_clip(
    source_path: str,
    start_sec: float,
    end_sec: float,
    out_path: Path,
) -> None:
    subprocess.run([
        'ffmpeg', '-y',
        '-ss', str(start_sec), '-to', str(end_sec),
        '-i', source_path,
        '-vf', VIDEO_SCALE + ',setsar=1',
        '-r', VIDEO_FPS,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-ar', '44100',
        str(out_path),
    ], check=True, capture_output=True)


def _make_title_card(word: str, out_png: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGB', (1280, 720), color=(0, 0, 0))
    draw = ImageDraw.Draw(img)

    font = None
    for font_path in [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/Arial.ttf',
        '/Library/Fonts/Arial.ttf',
    ]:
        try:
            font = ImageFont.truetype(font_path, size=100)
            break
        except (IOError, OSError):
            continue
    if font is None:
        font = ImageFont.load_default()

    clean = ' '.join(word.split())
    bbox = draw.textbbox((0, 0), clean, font=font)
    x = (1280 - (bbox[2] - bbox[0])) // 2
    y = (720 - (bbox[3] - bbox[1])) // 2
    draw.text((x, y), clean, fill=(255, 255, 255), font=font)
    img.save(str(out_png))


def make_subtitle_clip(word: str, audio: AudioSegment, out_path: Path) -> None:
    tmp_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp_png = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    tmp_audio.close()
    tmp_png.close()
    audio.export(tmp_audio.name, format='wav')

    try:
        _make_title_card(word, Path(tmp_png.name))
        result = subprocess.run([
            'ffmpeg', '-y',
            '-loop', '1', '-i', tmp_png.name,
            '-i', tmp_audio.name,
            '-vf', 'scale=1280:720',
            '-r', VIDEO_FPS,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-ar', '44100',
            '-shortest',
            str(out_path),
        ], check=False, capture_output=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode())
    finally:
        Path(tmp_audio.name).unlink(missing_ok=True)
        Path(tmp_png.name).unlink(missing_ok=True)


def concat_video_clips(clip_paths: list[Path], out_path: Path) -> None:
    tmp_list = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
    for p in clip_paths:
        tmp_list.write(f"file '{p.absolute()}'\n")
    tmp_list.close()
    try:
        result = subprocess.run([
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', tmp_list.name,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-ar', '44100',
            '-vsync', 'cfr', '-r', VIDEO_FPS,
            str(out_path),
        ], check=False, capture_output=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode())
    finally:
        Path(tmp_list.name).unlink(missing_ok=True)
