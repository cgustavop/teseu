import { useRef } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import { Play, Pause } from "@phosphor-icons/react";

type Props = {
  url: string;
  filename?: string;
};

export function WavePlayer({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { wavesurfer, isPlaying } = useWavesurfer({
    container: containerRef,
    url,
    waveColor: "#3a1060",
    progressColor: "#E70BDD",
    cursorColor: "#E70BDD",
    height: 72,
    barWidth: 2,
    barGap: 1,
    normalize: true,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={containerRef} style={{ cursor: "pointer" }} onClick={() => wavesurfer?.playPause()} />
      <button
        className="btn-primary"
        style={{ width: 56, padding: "6px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
        onClick={() => wavesurfer?.playPause()}
      >
        {isPlaying ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
      </button>
    </div>
  );
}
