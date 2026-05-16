import { useEffect, useRef, useState } from "react";

const API = "http://localhost:7731";

type Chop = {
  index: number;
  word: string;
  matched_word: string | null;
  is_tts: boolean;
  url: string | null;
};

type GenerateResult = {
  phrase_slug: string;
  joined_file: string | null;
  joined_url: string | null;
  chops: Chop[];
};

type IndexProgress = {
  type: string;
  file?: string;
  done?: number;
  total?: number;
  status?: string;
  words?: number;
  low_conf?: number;
  error?: string;
  errors?: number;
};

type Stats = { files: number; words: number; vocab: number };

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);

  const [phrase, setPhrase] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // generate options
  const [gapMs, setGapMs] = useState(0);
  const [useOnset, setUseOnset] = useState(false);
  const [tailBufferMs, setTailBufferMs] = useState(30);
  const [onsetThresholdDb, setOnsetThresholdDb] = useState(-35);
  const [video, setVideo] = useState(false);
  const [individual, setIndividual] = useState(false);

  // preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWord, setPreviewWord] = useState<string>("");
  const [previewIsVideo, setPreviewIsVideo] = useState(false);

  useEffect(() => { fetchStats(); }, []);

  async function fetchStats() {
    try {
      const r = await fetch(`${API}/stats`);
      setStats(await r.json());
    } catch {}
  }

  async function startIndex() {
    if (!folder) return;
    setIndexing(true);
    setIndexProgress(null);

    const r = await fetch(`${API}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    const { job_id } = await r.json();

    const es = new EventSource(`${API}/index/stream/${job_id}`);
    es.onmessage = (e) => {
      const msg: IndexProgress = JSON.parse(e.data);
      setIndexProgress(msg);
      if (msg.type === "done" || msg.type === "error") {
        es.close();
        setIndexing(false);
        fetchStats();
      }
    };
  }

  async function runGenerate() {
    if (!phrase.trim()) return;
    setGenerating(true);
    setResult(null);
    setError(null);

    try {
      const r = await fetch(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phrase,
          gap_ms: gapMs,
          use_onset: useOnset,
          tail_buffer_ms: tailBufferMs,
          onset_threshold_db: onsetThresholdDb,
          video,
          individual,
          concat: true,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: GenerateResult = await r.json();
      setResult(data);
      setPreviewUrl(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function openPreview(url: string, word: string, isVideo: boolean) {
    setPreviewUrl(`${API}${url}`);
    setPreviewWord(word);
    setPreviewIsVideo(isVideo);
  }

  function download(url: string, filename: string) {
    fetch(`${API}${url}`)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", minHeight: "100vh" }}>
      {/* sidebar */}
      <aside style={{ borderRight: "1px solid var(--border)", padding: 24, display: "flex", flexDirection: "column", gap: 24, overflow: "hidden", minWidth: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -1 }}>teseu</h1>
          {stats && (
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              {stats.files} files · {stats.words.toLocaleString()} words · {stats.vocab.toLocaleString()} vocab
            </p>
          )}
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Library</label>
          <input
            placeholder="/path/to/your/media"
            value={folder}
            onChange={e => setFolder(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={startIndex}
            disabled={indexing || !folder}
          >
            {indexing ? "Indexing…" : "Index folder"}
          </button>

          {indexProgress && (
            <div style={{ fontSize: 12 }}>
              {indexProgress.type === "progress" && (
                <>
                  <div style={{ color: "var(--muted)" }}>
                    {indexProgress.done}/{indexProgress.total} — {indexProgress.file}
                  </div>
                  <div style={{
                    height: 3,
                    background: "var(--border)",
                    borderRadius: 2,
                    marginTop: 6,
                  }}>
                    <div style={{
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 2,
                      width: `${((indexProgress.done ?? 0) / (indexProgress.total ?? 1)) * 100}%`,
                      transition: "width 0.2s",
                    }} />
                  </div>
                </>
              )}
              {indexProgress.type === "done" && (
                <span style={{ color: "var(--accent)" }}>
                  Done · {indexProgress.errors} errors
                </span>
              )}
              {indexProgress.type === "error" && (
                <span style={{ color: "var(--error)" }}>{indexProgress.error}</span>
              )}
            </div>
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Options</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={useOnset} onChange={e => setUseOnset(e.target.checked)} />
            Onset detection
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={video} onChange={e => setVideo(e.target.checked)} />
            Video output
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={individual} onChange={e => setIndividual(e.target.checked)} />
            Individual chop files
          </label>
          <label style={{ fontSize: 13 }}>
            Gap between words (ms)
            <input type="number" value={gapMs} min={0} step={50}
              onChange={e => setGapMs(Number(e.target.value))} style={{ marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 13 }}>
            Tail buffer (ms)
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <input type="range" min={0} max={300} step={10} value={tailBufferMs}
                onChange={e => setTailBufferMs(Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 32 }}>{tailBufferMs}</span>
            </div>
          </label>
          <label style={{ fontSize: 13 }}>
            Gate threshold (dB)
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <input type="range" min={-80} max={-10} step={5} value={onsetThresholdDb}
                onChange={e => setOnsetThresholdDb(Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 36 }}>{onsetThresholdDb}</span>
            </div>
          </label>
        </section>
      </aside>

      {/* main */}
      <main style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24, maxWidth: 800 }}>
        <section style={{ display: "flex", gap: 8 }}>
          <textarea
            rows={3}
            placeholder="Type a phrase…"
            value={phrase}
            onChange={e => setPhrase(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runGenerate(); }}
            style={{ resize: "vertical", flex: 1 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="btn-primary"
              onClick={runGenerate}
              disabled={generating || !phrase.trim()}
              style={{ whiteSpace: "nowrap" }}
            >
              {generating ? "Generating…" : "Generate ↵"}
            </button>
            {result && (
              <>
                <button className="btn-ghost" onClick={runGenerate} disabled={generating}>
                  Re-roll 🎲
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => { setResult(null); setPreviewUrl(null); }}
                  style={{ color: "var(--muted)" }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </section>

        {error && (
          <div style={{ color: "var(--error)", background: "#1a0000", border: "1px solid #400", borderRadius: "var(--radius)", padding: 12 }}>
            {error}
          </div>
        )}

        {result && (
          <>
            {result.joined_url && (
              <section style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: 16 }}>
                {result.joined_file?.endsWith(".mp4") ? (
                  <video
                    src={`${API}${result.joined_url}`}
                    controls
                    style={{ width: "100%", borderRadius: "var(--radius)", marginBottom: 8 }}
                  />
                ) : (
                  <audio
                    src={`${API}${result.joined_url}`}
                    controls
                    style={{ width: "100%", marginBottom: 8 }}
                  />
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className="btn-ghost"
                    onClick={() => setResult(null)}
                  >
                    ← Clear
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, color: "var(--muted)" }}
                    onClick={() => download(result.joined_url!, result.joined_file!)}
                  >
                    ↓ {result.joined_file}
                  </button>
                </div>
              </section>
            )}

            {/* mini preview player */}
            {previewUrl && (
              <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    preview: <strong style={{ color: "var(--text)" }}>{previewWord}</strong>
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => setPreviewUrl(null)}
                  >
                    ✕
                  </button>
                </div>
                {previewIsVideo ? (
                  <video src={previewUrl} controls autoPlay style={{ width: "100%", borderRadius: "var(--radius)" }} />
                ) : (
                  <audio src={previewUrl} controls autoPlay style={{ width: "100%" }} />
                )}
              </section>
            )}

            <section>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                {result.chops.length} words {individual && "· click to preview"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.chops.map(c => (
                  <div
                    key={c.index}
                    title={c.is_tts ? "TTS placeholder" : `matched: "${c.matched_word}"`}
                    onClick={() => c.url && openPreview(c.url, c.word, c.url.endsWith(".mp4"))}
                    style={{
                      background: c.is_tts ? "#1a1000" : "var(--surface)",
                      border: `1px solid ${c.is_tts ? "#443300" : "var(--border)"}`,
                      borderRadius: "var(--radius)",
                      padding: "4px 10px",
                      fontSize: 13,
                      cursor: c.url ? "pointer" : "default",
                    }}
                  >
                    {c.word}
                    {c.matched_word && c.matched_word.trim().toLowerCase() !== c.word.toLowerCase() && (
                      <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 4 }}>
                        ({c.matched_word.trim()})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
