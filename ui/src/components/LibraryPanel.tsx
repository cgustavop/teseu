import { FolderOpen } from "@phosphor-icons/react";
import { IndexProgress, Stats } from "../types";
import { API } from "../api";

type Props = {
  folder: string;
  onFolderChange: (v: string) => void;
  onIndex: () => void;
  indexing: boolean;
  progress: IndexProgress | null;
  stats: Stats | null;
};

export function LibraryPanel({ folder, onFolderChange, onIndex, indexing, progress, stats }: Props) {
  async function pickFolder() {
    try {
      const r = await fetch(`${API}/pick_folder`);
      if (!r.ok) return;
      const { path } = await r.json();
      if (path) onFolderChange(path);
    } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        className="btn-ghost"
        onClick={pickFolder}
        style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start" }}
      >
        <FolderOpen size={14} />
        {folder ? folder.split(/[\\/]/).pop() : "Import folder…"}
      </button>

      {folder && (
        <button
          className="btn-primary"
          onClick={onIndex}
          disabled={indexing || !folder}
          style={{ fontSize: 12 }}
        >
          {indexing ? "Indexing…" : "Index"}
        </button>
      )}

      {progress && (
        <div style={{ fontSize: 11 }}>
          {progress.type === "progress" && (
            <>
              <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {progress.done}/{progress.total}
              </div>
              <div style={{ height: 2, background: "var(--border)", borderRadius: 2, marginTop: 4 }}>
                <div style={{
                  height: "100%", background: "var(--accent)", borderRadius: 2,
                  width: `${((progress.done ?? 0) / (progress.total ?? 1)) * 100}%`,
                  transition: "width 0.2s",
                }} />
              </div>
            </>
          )}
          {progress.type === "done" && (
            <span style={{ color: "var(--accent)" }}>Indexed · {progress.errors} errors</span>
          )}
          {progress.type === "error" && (
            <span style={{ color: "var(--error)" }}>{progress.error}</span>
          )}
        </div>
      )}

      {stats && (
        <div style={{ fontSize: 10, color: "rgba(174,112,171,0.4)" }}>
          {stats.files} files · {stats.vocab.toLocaleString()} words
        </div>
      )}
    </div>
  );
}
