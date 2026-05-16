import { useEffect, useState } from "react";
import { GenerateOptions, GenerateResult, IndexProgress, Stats } from "./types";
import { API } from "./api";
import { LibraryPanel } from "./components/LibraryPanel";
import { OptionsPanel } from "./components/OptionsPanel";
import { GenerateInput } from "./components/GenerateInput";
import { OutputSection } from "./components/OutputSection";

const DEFAULT_OPTIONS: GenerateOptions = {
  gapMs: 0,
  useOnset: false,
  tailBufferMs: 30,
  onsetThresholdDb: -35,
  video: false,
  individual: true,
};

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);

  const [phrase, setPhrase] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_OPTIONS);

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
          gap_ms: options.gapMs,
          use_onset: options.useOnset,
          tail_buffer_ms: options.tailBufferMs,
          onset_threshold_db: options.onsetThresholdDb,
          video: options.video,
          individual: options.individual,
          concat: true,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setResult(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function clearResult() {
    setResult(null);
    setError(null);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", minHeight: "100vh" }}>
      <main style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24, maxWidth: 800 }}>
        <GenerateInput
          phrase={phrase}
          onChange={setPhrase}
          onGenerate={runGenerate}
          onClear={clearResult}
          generating={generating}
          hasResult={!!result}
        />

        {error && (
          <div style={{
            color: "var(--error)", background: "#1a0010",
            border: "1px solid #440022", borderRadius: "var(--radius)", padding: 12,
          }}>
            {error}
          </div>
        )}

        {result && (
          <OutputSection
            result={result}
            gapMs={options.gapMs}
            onClear={clearResult}
          />
        )}
      </main>

      <aside style={{
        borderLeft: "1px solid var(--border)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        overflow: "hidden",
        minWidth: 0,
      }}>
        <LibraryPanel
          folder={folder}
          onFolderChange={setFolder}
          onIndex={startIndex}
          indexing={indexing}
          progress={indexProgress}
          stats={stats}
        />
        <OptionsPanel
          options={options}
          onChange={patch => setOptions(prev => ({ ...prev, ...patch }))}
        />
      </aside>
    </div>
  );
}
