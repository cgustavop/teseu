import { useState } from "react";
import { Chop, GenerateResult } from "../types";
import { API, downloadFile } from "../api";
import { WavePlayer } from "./WavePlayer";
import { SampleChopTimeline } from "./SampleChopTimeline";

type Props = {
  result: GenerateResult;
  gapMs: number;
  onClear: () => void;
};

async function openOutputDir() {
  await fetch(`${API}/open_output_dir`, { method: "POST" });
}

export function OutputSection({ result, gapMs, onClear }: Props) {
  const [chops, setChops] = useState<Chop[]>(result.chops);
  const [joinedUrl, setJoinedUrl] = useState(
    result.joined_url ? `${API}${result.joined_url}` : null
  );

  const isVideo = result.joined_file?.endsWith(".mp4");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {joinedUrl && (
        <section style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: 16 }}>
          {isVideo ? (
            <>
              <video src={joinedUrl} controls style={{ width: "100%", borderRadius: "var(--radius)", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={onClear}>← Clear</button>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}
                  onClick={() => downloadFile(result.joined_url!, result.joined_file!)}
                >
                  ↓ {result.joined_file}
                </button>
              </div>
            </>
          ) : (
            <WavePlayer
              url={joinedUrl}
              filename={result.joined_file ?? undefined}
              onClear={onClear}
            />
          )}
        </section>
      )}

      <section style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: 16 }}>
        <SampleChopTimeline
          chops={chops}
          gapMs={gapMs}
          joinedFile={result.joined_file ?? null}
          onChopsChange={setChops}
          onRebaked={(url) => setJoinedUrl(`${API}${url}?t=${Date.now()}`)}
        />
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={openOutputDir}>
            ↗ Open chops folder
          </button>
        </div>
      </section>
    </div>
  );
}
