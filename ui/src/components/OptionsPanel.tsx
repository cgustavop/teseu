import { GenerateOptions } from "../types";
import { PillSlider } from "./PillSlider";

type Props = {
  options: GenerateOptions;
  onChange: (patch: Partial<GenerateOptions>) => void;
};

function Row({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <span style={{ fontSize: 11, letterSpacing: 1, color: "var(--muted)", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--purple-200)", fontVariantNumeric: "tabular-nums" }}>
        {value}{unit}
      </span>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function OptionsPanel({ options, onChange }: Props) {
  const { gapMs, useOnset, tailBufferMs, onsetThresholdDb, video, individual } = options;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row label="Gap" value={gapMs} unit="ms" />
        <PillSlider value={gapMs} min={0} max={500} step={10} onChange={v => onChange({ gapMs: v })} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row label="Tail buffer" value={tailBufferMs} unit="ms" />
        <PillSlider value={tailBufferMs} min={0} max={300} step={10} onChange={v => onChange({ tailBufferMs: v })} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row label="Gate threshold" value={onsetThresholdDb} unit="dB" />
        <PillSlider value={onsetThresholdDb} min={-80} max={-10} step={5} onChange={v => onChange({ onsetThresholdDb: v })} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
        <CheckRow label="Onset detection" checked={useOnset} onChange={v => onChange({ useOnset: v })} />
        <CheckRow label="Video output" checked={video} onChange={v => onChange({ video: v })} />
        <CheckRow label="Individual chop files" checked={individual} onChange={v => onChange({ individual: v })} />
      </div>
    </div>
  );
}
