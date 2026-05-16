import { Chop } from "../types";
import { API } from "../api";

type Props = {
  chops: Chop[];
  individual: boolean;
  onPreview: (url: string, word: string, isVideo: boolean) => void;
};

export function WordChips({ chops, individual, onPreview }: Props) {
  return (
    <section>
      <div style={{
        fontSize: 11, color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
      }}>
        {chops.length} words {individual && "· click to preview"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chops.map(c => (
          <div
            key={c.index}
            title={c.is_tts ? "TTS placeholder" : `matched: "${c.matched_word}"`}
            onClick={() => c.url && onPreview(`${API}${c.url}`, c.word, c.url.endsWith(".mp4"))}
            style={{
              background: c.is_tts ? "#1a1000" : "var(--surface)",
              border: `1px solid ${c.is_tts ? "#443300" : "var(--border)"}`,
              borderRadius: "var(--radius)",
              padding: "4px 10px",
              fontSize: 13,
              cursor: c.url ? "pointer" : "default",
              userSelect: "none",
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
  );
}
