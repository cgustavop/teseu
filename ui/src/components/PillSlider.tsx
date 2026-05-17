import { useRef } from "react";

type Props = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};

export function PillSlider({ value, min, max, step, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  function compute(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const raw = min + (x / rect.width) * (max - min);
    return Math.round(raw / step) * step;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(compute(e.clientX));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.buttons) return;
    onChange(compute(e.clientX));
  }

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        height: 32,
        background: "rgba(42,0,40,0.8)",
        borderRadius: 16,
        cursor: "pointer",
        userSelect: "none",
        border: "1px solid var(--border)",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      {/* fill */}
      <div style={{
        position: "absolute",
        left: 0, top: 0, bottom: 0,
        width: `${pct}%`,
        background: "#AE70AB",
        borderRadius: 16,
        pointerEvents: "none",
      }} />
    </div>
  );
}
