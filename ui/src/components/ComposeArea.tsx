import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, ArrowUpRight, FolderOpen, Shuffle } from "@phosphor-icons/react";
import { checkWords, getSuggestions } from "../api";

type Props = {
  phrase: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRandomize: () => void;
  onLibrarySettings: () => void;
  generating: boolean;
  hasResult: boolean;
};

type WordStatus = Record<string, boolean>;

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parsePhrase(text: string) {
  const endsWithSpace = /\s$/.test(text) || text === "";
  const tokens = text.split(/(\s+)/);
  const words = tokens.filter(t => !/^\s*$/.test(t));
  const partial = endsWithSpace ? "" : (words.pop() ?? "");
  return { complete: words, partial };
}

export function ComposeArea({
  phrase, onChange, onGenerate, onRegenerate, onRandomize, onLibrarySettings, generating, hasResult,
}: Props) {
  const [wordStatus, setWordStatus] = useState<WordStatus>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>();
  const suggestTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(checkTimer.current);
    const { complete } = parsePhrase(phrase);
    if (!complete.length) return;
    checkTimer.current = setTimeout(async () => {
      const data = await checkWords(complete.map(w => w.toLowerCase()));
      setWordStatus(prev => ({ ...prev, ...data }));
    }, 350);
  }, [phrase]);

  useEffect(() => {
    clearTimeout(suggestTimer.current);
    const { partial } = parsePhrase(phrase);
    if (partial.length < 2) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      setSuggestions(await getSuggestions(partial));
    }, 180);
  }, [phrase]);

  function completeSuggestion(word: string) {
    const { complete } = parsePhrase(phrase);
    const base = complete.length ? complete.join(" ") + " " : "";
    onChange(base + word + " ");
    setSuggestions([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && suggestions.length) {
      e.preventDefault();
      completeSuggestion(suggestions[0]);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (phrase.trim()) onGenerate();
    }
  }

  function buildMirror() {
    const tokens = phrase.split(/(\s+)/);
    return tokens.map(token => {
      if (/^\s+$/.test(token)) return token.replace(/ /g, " ");
      const key = token.toLowerCase();
      const status = wordStatus[key];
      if (status === true) {
        return `<span style="background:rgba(174,112,171,0.18);border-radius:3px;box-shadow:3px 0 0 rgba(174,112,171,0.18),-3px 0 0 rgba(174,112,171,0.18)">${escHtml(token)}</span>`;
      }
      if (status === false) {
        return `<span style="background:rgba(255,100,200,0.08);border-radius:3px;box-shadow:3px 0 0 rgba(255,100,200,0.08),-3px 0 0 rgba(255,100,200,0.08)">${escHtml(token)}</span>`;
      }
      return escHtml(token);
    }).join("") + " ";
  }

  const sharedStyle: React.CSSProperties = {
    padding: "14px",
    fontSize: 15,
    lineHeight: 1.65,
    fontFamily: "var(--font)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    minHeight: 80,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 2,
    color: "rgba(174,112,171,0.4)",
    textTransform: "uppercase",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={labelStyle}>Compose</span>
        <button
          onClick={onLibrarySettings}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "rgba(174,112,171,0.5)",
            cursor: "pointer",
          }}
        >
          <FolderOpen size={13} />
          Library settings
        </button>
      </div>

      {/* textarea */}
      <div className="compose-animated-bg" style={{
        position: "relative",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}>
        <div
          dangerouslySetInnerHTML={{ __html: buildMirror() }}
          style={{
            ...sharedStyle,
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            color: "transparent",
            overflow: "hidden",
          }}
        />
        <textarea
          ref={textareaRef}
          value={phrase}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a phrase…"
          style={{
            ...sharedStyle,
            position: "relative",
            zIndex: 2,
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            color: "var(--text)",
            caretColor: "var(--text)",
          }}
        />
      </div>

      {/* bottom row: suggestions left | Generate + Randomize right */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
        {/* suggestions */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => completeSuggestion(s)}
              style={{
                background: "transparent", border: "none", padding: 0,
                fontSize: 13, color: "var(--muted)", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 3,
              }}
            >
              {s} <ArrowUpRight size={11} weight="bold" />
            </button>
          ))}
          {hasResult && !suggestions.length && (
            <button
              onClick={onRegenerate}
              style={{
                background: "transparent", border: "none", padding: 0,
                fontSize: 12, color: "var(--muted)", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <ArrowsClockwise size={13} /> Re-generate
            </button>
          )}
        </div>

        {/* actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onGenerate}
            disabled={generating || !phrase.trim()}
            style={{
              background: generating ? "rgba(174,112,171,0.2)" : "var(--accent-gradient)",
              border: "none",
              borderRadius: 20,
              padding: "7px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: "white",
              cursor: generating || !phrase.trim() ? "not-allowed" : "pointer",
            }}
          >
            {generating ? "…" : "Generate"}
          </button>

          <button
            onClick={onRandomize}
            disabled={generating}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "var(--muted)",
              cursor: generating ? "not-allowed" : "pointer",
            }}
          >
            <Shuffle size={14} />
            Randomize
          </button>
        </div>
      </div>
    </div>
  );
}
