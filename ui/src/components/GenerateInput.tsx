type Props = {
  phrase: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  onClear: () => void;
  generating: boolean;
  hasResult: boolean;
};

export function GenerateInput({ phrase, onChange, onGenerate, onClear, generating, hasResult }: Props) {
  return (
    <section style={{ display: "flex", gap: 8 }}>
      <textarea
        rows={3}
        placeholder="Type a phrase…"
        value={phrase}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onGenerate(); }}
        style={{ resize: "vertical", flex: 1 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          className="btn-primary"
          onClick={onGenerate}
          disabled={generating || !phrase.trim()}
          style={{ whiteSpace: "nowrap" }}
        >
          {generating ? "Generating…" : "Generate ↵"}
        </button>
        {hasResult && (
          <>
            <button className="btn-ghost" onClick={onGenerate} disabled={generating}>
              Re-roll 🎲
            </button>
            <button
              className="btn-ghost"
              onClick={onClear}
              style={{ color: "var(--muted)" }}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </section>
  );
}
