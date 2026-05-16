import { IndexProgress, Stats } from "../types";

type Props = {
  folder: string;
  onFolderChange: (v: string) => void;
  onIndex: () => void;
  indexing: boolean;
  progress: IndexProgress | null;
  stats: Stats | null;
};

export function LibraryPanel({ folder, onFolderChange, onIndex, indexing, progress, stats }: Props) {
  return (
    <>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -1 }}>teseu</h1>
        {stats && (
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            {stats.files} files · {stats.words.toLocaleString()} words · {stats.vocab.toLocaleString()} vocab
          </p>
        )}
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Library
        </label>
        <input
          placeholder="/path/to/your/media"
          value={folder}
          onChange={e => onFolderChange(e.target.value)}
        />
        <button className="btn-primary" onClick={onIndex} disabled={indexing || !folder}>
          {indexing ? "Indexing…" : "Index folder"}
        </button>

        {progress && (
          <div style={{ fontSize: 12 }}>
            {progress.type === "progress" && (
              <>
                <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {progress.done}/{progress.total} — {progress.file}
                </div>
                <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginTop: 6 }}>
                  <div style={{
                    height: "100%", background: "var(--accent)", borderRadius: 2,
                    width: `${((progress.done ?? 0) / (progress.total ?? 1)) * 100}%`,
                    transition: "width 0.2s",
                  }} />
                </div>
              </>
            )}
            {progress.type === "done" && (
              <span style={{ color: "var(--accent)" }}>Done · {progress.errors} errors</span>
            )}
            {progress.type === "error" && (
              <span style={{ color: "var(--error)" }}>{progress.error}</span>
            )}
          </div>
        )}
      </section>
    </>
  );
}
