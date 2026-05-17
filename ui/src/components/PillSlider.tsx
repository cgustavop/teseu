import { useRef } from "react";

type Props = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};

const PILL_W = 56;

export function PillSlider({ value, min, max, step, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  function compute(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    const usable = rect.width - PILL_W;
    const x = Math.max(0, Math.min(usable, clientX - rect.left - PILL_W / 2));
    const raw = min + (x / usable) * (max - min);
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
      {/* fill behind pill */}
      <div style={{
        position: "absolute",
        left: 0, top: 0, bottom: 0,
        width: `calc(${pct / 100} * (100% - ${PILL_W}px) + ${PILL_W / 2}px)`,
        background: "rgba(174,112,171,0.25)",
        borderRadius: 16,
        pointerEvents: "none",
      }} />
      {/* pill */}
      <div style={{
        position: "absolute",
        top: 3, bottom: 3,
        width: PILL_W,
        left: `calc(${pct / 100} * (100% - ${PILL_W}px))`,
        background: "linear-gradient(135deg, #E70BDD 0%, #AE70AB 100%)",
        borderRadius: 12,
        pointerEvents: "none",
        boxShadow: "0 0 8px rgba(231,11,221,0.4)",
      }} />
    </div>
  );
}
