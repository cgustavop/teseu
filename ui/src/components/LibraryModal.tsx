import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash } from "@phosphor-icons/react";
import { Folder, IndexProgress } from "../types";
import { API } from "../api";
import { getFolders, setFolderEnabled, updateFolders, deleteFolder } from "../api";

type Props = { onClose: () => void };

export function LibraryModal({ onClose }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [working, setWorking] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadFolders();
    return () => esRef.current?.close();
  }, []);

  async function loadFolders() {
    setFolders(await getFolders());
  }

  function streamJob(jobId: string) {
    esRef.current?.close();
    const es = new EventSource(`${API}/index/stream/${jobId}`);
    esRef.current = es;
    es.onmessage = (e) => {
      const msg: IndexProgress = JSON.parse(e.data);
      setProgress(msg);
      if (msg.type === "done" || msg.type === "error") {
        es.close();
        setWorking(false);
        loadFolders();
      }
    };
  }

  async function handleToggle(id: number, enabled: boolean) {
    await setFolderEnabled(id, enabled);
    setFolders(prev => prev.map(f => f.id === id ? { ...f, enabled } : f));
  }

  async function handleDelete(id: number) {
    await deleteFolder(id);
    setFolders(prev => prev.filter(f => f.id !== id));
  }

  async function handleAddFolder() {
    try {
      const r = await fetch(`${API}/pick_folder`);
      if (!r.ok) return;
      const { path } = await r.json();
      if (!path) return;
      setWorking(true);
      setProgress(null);
      const ir = await fetch(`${API}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: path }),
      });
      const { job_id } = await ir.json();
      streamJob(job_id);
    } catch {}
  }

  async function handleUpdate() {
    setWorking(true);
    setProgress(null);
    const { job_id, new_files } = await updateFolders();
    if (new_files === 0) {
      setWorking(false);
      setProgress({ type: "done", errors: 0, total: 0 });
      return;
    }
    streamJob(job_id);
  }

  const totalWords = folders.filter(f => f.enabled).reduce((s, f) => s + f.word_count, 0);
  const totalFiles = folders.filter(f => f.enabled).reduce((s, f) => s + f.file_count, 0);

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: 2,
    color: "rgba(174,112,171,0.4)", textTransform: "uppercase",
  };

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        width: 560,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={labelStyle}>Library settings</span>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", padding: 4, color: "var(--muted)", cursor: "pointer", display: "flex" }}
            >
              <X size={14} />
            </button>
          </div>

          {/* stats */}
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--muted)" }}>
            <span>{totalWords.toLocaleString()} words</span>
            <span style={{ color: "var(--border)" }}>|</span>
            <span>{totalFiles} files</span>
            <span style={{ color: "var(--border)" }}>|</span>
            <span>{folders.filter(f => f.enabled).length} / {folders.length} folders active</span>
          </div>
        </div>

        {/* folder list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {folders.length === 0 ? (
            <div style={{ padding: 24, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
              No folders indexed yet
            </div>
          ) : folders.map(folder => (
            <label
              key={folder.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 24px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  color: folder.enabled ? "var(--text)" : "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {folder.path}
                </div>
                <div style={{ fontSize: 10, color: "rgba(174,112,171,0.4)", marginTop: 2 }}>
                  {folder.word_count.toLocaleString()} words · {folder.file_count} files
                </div>
              </div>
              <button
                onClick={e => { e.preventDefault(); handleDelete(folder.id); }}
                style={{
                  background: "transparent", border: "none", padding: 4,
                  color: "var(--muted)", cursor: "pointer",
                  display: "flex", flexShrink: 0,
                }}
                title="Remove folder"
              >
                <Trash size={13} />
              </button>
              <input
                type="checkbox"
                checked={folder.enabled}
                onChange={e => handleToggle(folder.id, e.target.checked)}
                onClick={e => e.stopPropagation()}
                style={{ flexShrink: 0 }}
              />
            </label>
          ))}
        </div>

        {/* progress */}
        {progress && (
          <div style={{ padding: "8px 24px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {progress.type === "progress" && progress.total ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 2, background: "var(--border)", borderRadius: 2 }}>
                  <div style={{
                    height: "100%", background: "var(--accent)", borderRadius: 2,
                    width: `${((progress.done ?? 0) / progress.total) * 100}%`,
                    transition: "width 0.2s",
                  }} />
                </div>
                <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
                  {progress.done}/{progress.total}
                </span>
              </div>
            ) : progress.type === "done" ? (
              <span style={{ fontSize: 11, color: "var(--accent)" }}>
                {progress.total === 0 ? "No new files found" : `Done · ${progress.errors ?? 0} errors`}
              </span>
            ) : progress.type === "error" ? (
              <span style={{ fontSize: 11, color: "var(--error)" }}>{progress.error}</span>
            ) : null}
          </div>
        )}

        {/* footer */}
        <div style={{
          padding: "14px 24px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
          display: "flex",
          gap: 10,
        }}>
          <button
            className="btn-ghost"
            onClick={handleAddFolder}
            disabled={working}
            style={{ fontSize: 12, padding: "7px 16px" }}
          >
            Add folder
          </button>
          <button
            className="btn-primary"
            onClick={handleUpdate}
            disabled={working || folders.filter(f => f.enabled).length === 0}
            style={{ fontSize: 12, padding: "7px 16px" }}
          >
            {working ? "Working…" : "Update"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
