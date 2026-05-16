type Props = {
  url: string;
  word: string;
  isVideo: boolean;
  onClose: () => void;
};

export function MiniPlayer({ url, word, isVideo, onClose }: Props) {
  return (
    <section style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          preview: <strong style={{ color: "var(--text)" }}>{word}</strong>
        </span>
        <button
          className="btn-ghost"
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {isVideo ? (
        <video src={url} controls autoPlay style={{ width: "100%", borderRadius: "var(--radius)" }} />
      ) : (
        <audio src={url} controls autoPlay style={{ width: "100%" }} />
      )}
    </section>
  );
}
