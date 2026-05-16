import sys
from pathlib import Path

import click

from .db import get_conn, init_db
from .generator import generate
from .indexer import find_media, index_file


@click.group()
def cli():
    pass


@cli.command(name='index')
@click.argument('folder', type=click.Path(exists=True, file_okay=False))
@click.option('--model', default='base', show_default=True,
              help='Whisper model size: tiny | base | small | medium | large')
@click.option('--language', default=None, show_default=True,
              help='Force language code e.g. pt, en, es (auto-detect if omitted)')
@click.option('--min-confidence', default=0.75, show_default=True,
              help='Minimum Whisper word probability to index (0.0-1.0)')
def cmd_index(folder: str, model: str, language: str, min_confidence: float) -> None:
    """Transcribe and index media files in FOLDER."""
    import whisper as _whisper

    conn = get_conn()
    init_db(conn)

    click.echo(f"Loading Whisper '{model}'...")
    wmodel = _whisper.load_model(model)

    files = list(find_media(Path(folder)))
    click.echo(f"Found {len(files)} media files.")

    total_indexed = total_low_conf = errors = file_skipped = 0
    for i, f in enumerate(files, 1):
        click.echo(f"[{i}/{len(files)}] {f.name} ...", nl=False)
        try:
            result = index_file(f, wmodel, conn, language=language, min_confidence=min_confidence)
            if result is False:
                click.echo(" skip (already indexed)")
                file_skipped += 1
            else:
                n_words, n_low = result
                click.echo(f" ok ({n_words} words, {n_low} low-confidence dropped)")
                total_indexed += 1
                total_low_conf += n_low
        except Exception as e:
            click.echo(f" ERROR: {e}")
            errors += 1

    click.echo(f"\nfiles indexed={total_indexed} skipped={file_skipped} errors={errors}")
    click.echo(f"words dropped (low confidence)={total_low_conf}")


@cli.command(name='gen')
@click.argument('phrase')
@click.option('--sample-rate',                default=44100,   show_default=True)
@click.option('--normalize-lufs',             default=-16.0,   show_default=True,
              help='Target loudness in LUFS (perceived). Use 0 to skip.')
@click.option('--match-threshold',            default=80,      show_default=True,
              help='Fuzzy match score 0-100')
@click.option('--output',                     default='./teseu_out', show_default=True)
@click.option('--gap-ms',                     default=0,       show_default=True,
              help='Silence between chops in ms')
@click.option('--fade-in-ms',                 default=5,       show_default=True)
@click.option('--fade-out-ms',                default=15,      show_default=True)
@click.option('--onset-search-ms',            default=100,     show_default=True,
              help='Search window around Whisper timestamp for onset/release (ms)')
@click.option('--onset-threshold-db',         default=-35.0,   show_default=True,
              help='Energy gate threshold for release detection (dB)')
@click.option('--onset/--no-onset',           default=True,    show_default=True,
              help='Use onset/release detection. --no-onset cuts on raw Whisper timestamps.')
@click.option('--concat/--no-concat',         default=True,    show_default=True,
              help='Output joined file')
@click.option('--individual/--no-individual', default=True,    show_default=True,
              help='Output per-word files')
@click.option('--video',                      is_flag=True,    default=False,
              help='Generate video output (mp4). Uses source video if available, else subtitle on black.')
def cmd_gen(
    phrase: str,
    sample_rate: int,
    normalize_lufs: float,
    match_threshold: int,
    output: str,
    gap_ms: int,
    fade_in_ms: int,
    fade_out_ms: int,
    onset_search_ms: int,
    onset_threshold_db: float,
    onset: bool,
    concat: bool,
    individual: bool,
    video: bool,
) -> None:
    """Generate word chops for PHRASE.

    \b
    Audio quality:
      --fade-in-ms          Fade-in on each chop (ms)                [default: 5]
      --fade-out-ms         Fade-out on each chop (ms)               [default: 15]
      --onset-search-ms     Search window around Whisper timestamp    [default: 100]
                            for onset (start) and energy gate (end)
      --onset-threshold-db  Gate threshold for release detection (dB) [default: -35]
      --normalize-lufs      Target perceived loudness in LUFS         [default: -16]
                            Use 0 to skip normalization

    \b
    Output:
      --sample-rate         Output WAV sample rate (Hz)              [default: 44100]
      --output              Output folder                            [default: ./teseu_out]
      --gap-ms              Silence between chops in joined file (ms)[default: 0]
      --concat/--no-concat  Write joined output file                 [default: on]
      --individual/         Write per-word files                     [default: on]
        --no-individual
      --video               Generate MP4 instead of WAV.
                            Uses source video clip if available,
                            else black frame with word subtitle.

    \b
    Search:
      --match-threshold     Fuzzy match score 0-100                  [default: 80]
    """
    def _progress(current: int, total: int, msg: str) -> None:
        click.echo(f"[{current}/{total}] {msg}")

    result = generate(
        phrase=phrase,
        output_dir=Path(output),
        sample_rate=sample_rate,
        normalize_lufs=normalize_lufs,
        gap_ms=gap_ms,
        fade_in_ms=fade_in_ms,
        fade_out_ms=fade_out_ms,
        onset_search_ms=onset_search_ms,
        onset_threshold_db=onset_threshold_db,
        use_onset=onset,
        match_threshold=match_threshold,
        concat=concat,
        individual=individual,
        video=video,
        progress=_progress,
    )

    for chop in result.chops:
        if chop.output_file:
            click.echo(f"         → {Path(output) / chop.output_file}")

    if result.joined_file:
        click.echo(f"\njoined → {Path(output) / result.joined_file}")


def main() -> None:
    known_subcmds = {'index', 'gen', '--help', '-h', '--version'}
    if len(sys.argv) > 1 and sys.argv[1] not in known_subcmds:
        sys.argv.insert(1, 'gen')
    cli()
