import { useEffect, useState } from "react";
import { FolderOpen, ArrowsClockwise, X } from "@phosphor-icons/react";
import { Chop, GenerateOptions, IndexProgress, Stats } from "./types";
import { API, getRandomWords, copyToClipboard, exportSession, getOutputDir, setOutputDir } from "./api";
import { ComposeArea } from "./components/ComposeArea";
import { OutputSection } from "./components/OutputSection";
import { PreviewPanel } from "./components/PreviewPanel";
import { OptionsPanel } from "./components/OptionsPanel";
import { LibraryModal } from "./components/LibraryModal";

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
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_OPTIONS);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);

  // lifted output state
  const [chops, setChops] = useState<Chop[]>([]);
  const [joinedUrl, setJoinedUrl] = useState<string | null>(null);
  const [joinedFile, setJoinedFile] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [outputDir, setOutputDirState] = useState("");

  const hasResult = chops.length > 0;

  useEffect(() => { fetchStats(); getOutputDir().then(setOutputDirState); }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "c") {
        // clipboard: audio/video only (no thumbnails — Ableton doesn't want PNGs)
        const mediaFiles = [
          ...(chops.map(c => c.output_file).filter(Boolean) as string[]),
          ...(joinedFile ? [joinedFile] : []),
        ];
        if (mediaFiles.length) {
          e.preventDefault();
          copyToClipboard(mediaFiles).catch(() => {});
        }
        return;
      }

      if (mod && e.key === "s") {
        e.preventDefault();
        // export: all files — audio/video + thumbnails
        const allFiles = [
          ...(chops.map(c => c.output_file).filter(Boolean) as string[]),
          ...(chops.map(c => c.thumbnail_file).filter(Boolean) as string[]),
          ...(joinedFile ? [joinedFile] : []),
        ];
        exportSession(allFiles).catch(() => {});
        return;
      }

      // 1–9 — play corresponding chop (only when not typing)
      const inInput = (e.target as Element).closest?.("input, textarea, [contenteditable]");
      if (inInput) return;

      if (e.key >= "1" && e.key <= "9" && !mod && !e.altKey) {
        const idx = parseInt(e.key, 10) - 1;
        const chop = chops[idx];
        if (chop?.url) {
          const audio = new Audio(chop.url);
          audio.play().catch(() => {});
        }
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [chops, joinedFile]);

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

  async function pickFolder() {
    try {
      const r = await fetch(`${API}/pick_folder`);
      if (!r.ok) return;
      const { path } = await r.json();
      if (path) setFolder(path);
    } catch {}
  }

  async function openOutputDir() {
    await fetch(`${API}/open_output_dir`, { method: "POST" });
  }

  async function changeOutputDir() {
    const path = await setOutputDir();
    if (path) setOutputDirState(path);
  }

  function applyResult(data: any, append: boolean) {
    const ts = Date.now();
    const newChops: Chop[] = data.chops.map((c: Chop) => ({
      ...c,
      url: c.url ? `${c.url}?t=${ts}` : c.url,
      thumbnail_url: c.thumbnail_url ? `${c.thumbnail_url}?t=${ts}` : c.thumbnail_url,
    }));
    setChops(prev => {
      if (!append) return newChops;
      const offset = prev.length > 0 ? Math.max(...prev.map(c => c.index)) + 1 : 0;
      return [...prev, ...newChops.map(c => ({ ...c, index: c.index + offset }))];
    });
    if (data.joined_url) {
      setJoinedUrl(`${API}${data.joined_url}?t=${Date.now()}`);
      setJoinedFile(data.joined_file ?? null);
      setIsVideo(!!data.joined_file?.endsWith(".mp4"));
    }
  }

  async function callGenerate(p: string, append: boolean) {
    const r = await fetch(`${API}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phrase: p,
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
    applyResult(await r.json(), append);
  }

  async function runGenerate() {
    if (!phrase.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await callGenerate(phrase, false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function regenerate() {
    if (!phrase.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await callGenerate(phrase, false);
      setSettingsDirty(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function randomize() {
    setGenerating(true);
    setError(null);
    try {
      const words = await getRandomWords(6);
      if (!words.length) return;
      const p = words.join(" ");
      setPhrase(p);
      await callGenerate(p, false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function clearAll() {
    setChops([]);
    setJoinedUrl(null);
    setJoinedFile(null);
    setIsVideo(false);
    setError(null);
    setSettingsDirty(false);
  }

  const sidebarLabel: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 2,
    color: "rgba(174,112,171,0.4)",
    textTransform: "uppercase",
  };

  return (
    <>
    {showLibraryModal && <LibraryModal onClose={() => setShowLibraryModal(false)} />}
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 320px",
      height: "100vh",
      overflow: "hidden",
    }}>
      {/* ── left ── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>

        {/* header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>teseu</h1>
            {stats && (
              <span style={{ fontSize: 10, color: "rgba(174,112,171,0.4)" }}>
                {stats.files} files · {stats.vocab.toLocaleString()} words
              </span>
            )}
            {hasResult && (
              <button
                onClick={clearAll}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  padding: "2px 6px",
                  color: "rgba(174,112,171,0.5)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                }}
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          <ComposeArea
            phrase={phrase}
            onChange={setPhrase}
            onGenerate={runGenerate}
            onRegenerate={regenerate}
            onRandomize={randomize}
            onLibrarySettings={() => setShowLibraryModal(true)}
            generating={generating}
            hasResult={hasResult}
          />

          {error && (
            <div style={{
              marginTop: 10,
              color: "#ff6eb4",
              background: "rgba(255,0,100,0.06)",
              border: "1px solid rgba(255,0,100,0.15)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* timeline */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
          {hasResult ? (
            <OutputSection
              chops={chops}
              onChopsChange={setChops}
              gapMs={options.gapMs}
              joinedFile={joinedFile}
              isVideo={isVideo}
              onRebaked={(url) => setJoinedUrl(`${API}${url}?t=${Date.now()}`)}
            />
          ) : (
            <div style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(174,112,171,0.25)",
              fontSize: 12,
            }}>
              Type a phrase and press Enter
            </div>
          )}
        </div>

        {/* bottom bar */}
        <div style={{
          padding: "8px 24px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <button
            className="btn-ghost"
            onClick={pickFolder}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 12px" }}
          >
            <FolderOpen size={13} />
            {folder ? folder.split(/[\\/]/).pop() : "Import folder…"}
          </button>

          {folder && (
            <button
              className="btn-ghost"
              onClick={startIndex}
              disabled={indexing}
              style={{ fontSize: 11, padding: "5px 12px" }}
            >
              {indexing ? "Indexing…" : "Index"}
            </button>
          )}

          {indexProgress?.type === "progress" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4 }}>
              <div style={{ width: 80, height: 2, background: "var(--border)", borderRadius: 2 }}>
                <div style={{
                  height: "100%", background: "var(--accent)", borderRadius: 2,
                  width: `${((indexProgress.done ?? 0) / (indexProgress.total ?? 1)) * 100}%`,
                  transition: "width 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>
                {indexProgress.done}/{indexProgress.total}
              </span>
            </div>
          )}
          {indexProgress?.type === "done" && (
            <span style={{ fontSize: 10, color: "var(--accent)" }}>Indexed</span>
          )}
        </div>
      </div>

      {/* ── right sidebar ── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* preview */}
        <div style={{ padding: "20px 20px 16px", flexShrink: 0 }}>
          <div style={{ ...sidebarLabel, marginBottom: 10 }}>Preview</div>
          <PreviewPanel url={joinedUrl} isVideo={isVideo} />
        </div>

        {/* destination */}
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "12px 20px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}>
          <span style={{ ...sidebarLabel, marginBottom: 0 }}>Destination</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={changeOutputDir}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                fontSize: 11,
                color: "var(--muted)",
                cursor: "pointer",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "right",
                height: "auto",
              }}
              title={outputDir}
            >
              {outputDir
                ? outputDir.split(/[\\/]/).filter(Boolean).slice(-3).join(" / ")
                : "teseu_out"}
            </button>
            <button
              onClick={openOutputDir}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                display: "flex",
                alignItems: "center",
                color: "var(--muted)",
                cursor: "pointer",
                flexShrink: 0,
                height: "auto",
              }}
              title="Open in Finder / Explorer"
            >
              <FolderOpen size={14} />
            </button>
          </div>
        </div>

        {/* settings */}
        <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid var(--border)", padding: "16px 20px 20px" }}>
          <div style={{ ...sidebarLabel, marginBottom: 12 }}>Settings</div>
          <OptionsPanel
            options={options}
            onChange={patch => {
              setOptions(prev => ({ ...prev, ...patch }));
              if (hasResult) setSettingsDirty(true);
            }}
          />

          {settingsDirty && hasResult && (
            <button
              onClick={regenerate}
              disabled={generating}
              style={{
                marginTop: 16,
                width: "100%",
                background: "var(--accent-gradient)",
                border: "none",
                borderRadius: 20,
                padding: "7px 16px",
                color: "white",
                cursor: generating ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <ArrowsClockwise size={13} />
              {generating ? "Applying…" : "Apply settings"}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
