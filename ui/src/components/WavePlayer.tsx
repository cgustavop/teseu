import { useRef } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import { downloadFile } from "../api";

type Props = {
  url: string;
  filename?: string;
  onClear?: () => void;
};

export function WavePlayer({ url, filename, onClear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { wavesurfer, isPlaying } = useWavesurfer({
    container: containerRef,
    url,
    waveColor: "#2e1860",
    progressColor: "#b060f0",
    cursorColor: "#c080ff",
    height: 80,
    barWidth: 2,
    barGap: 1,
    normalize: true,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={containerRef} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn-primary"
          style={{ minWidth: 56 }}
          onClick={() => wavesurfer?.playPause()}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        {onClear && (
          <button className="btn-ghost" onClick={onClear}>
            ← Clear
          </button>
        )}
        {filename && (
          <button
            className="btn-ghost"
            style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}
            onClick={() => downloadFile(url.replace("http://localhost:7731", ""), filename)}
          >
            ↓ {filename}
          </button>
        )}
      </div>
    </div>
  );
}
