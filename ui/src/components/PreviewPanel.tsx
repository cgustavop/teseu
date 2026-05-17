import { useRef } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import { Play, Pause } from "@phosphor-icons/react";

type Props = {
  url: string | null;
  isVideo?: boolean;
};

export function PreviewPanel({ url, isVideo }: Props) {
  const waveRef = useRef<HTMLDivElement>(null);
  const { wavesurfer, isPlaying } = useWavesurfer({
    container: waveRef,
    url: (!isVideo && url) ? url : undefined,
    waveColor: "#FFCCFD",
    progressColor: "#E70BDD",
    height: 64,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
  });

  if (!url) {
    return (
      <div style={{
        height: 160,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(174,112,171,0.25)",
        fontSize: 12,
        background: "var(--card)",
        borderRadius: "var(--radius)",
      }}>
        No output yet
      </div>
    );
  }

  if (isVideo) {
    return (
      <div style={{ borderRadius: "var(--radius)", overflow: "hidden", background: "var(--card)" }}>
        <video
          src={url}
          controls
          style={{ width: "100%", display: "block" }}
        />
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--card)",
      borderRadius: "var(--radius)",
      padding: "12px 14px 14px",
    }}>
      <div
        ref={waveRef}
        onClick={() => wavesurfer?.playPause()}
        style={{ cursor: "pointer", marginBottom: 10 }}
      />
      <button
        onClick={() => wavesurfer?.playPause()}
        style={{
          background: "var(--accent-gradient)",
          border: "none",
          borderRadius: 16,
          padding: "5px 16px",
          color: "white",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {isPlaying ? <Pause size={11} weight="fill" /> : <Play size={11} weight="fill" />}
        {isPlaying ? "Pause" : "Play"}
      </button>
    </div>
  );
}
