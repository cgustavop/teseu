import { GenerateOptions } from "../types";

type Props = {
  options: GenerateOptions;
  onChange: (patch: Partial<GenerateOptions>) => void;
};

function SliderRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label style={{ fontSize: 13 }}>
      {label}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 40, textAlign: "right" }}>
          {value}{unit}
        </span>
      </div>
    </label>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function OptionsPanel({ options, onChange }: Props) {
  const { gapMs, useOnset, tailBufferMs, onsetThresholdDb, video, individual } = options;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
        Options
      </label>

      <CheckRow label="Onset detection" checked={useOnset} onChange={v => onChange({ useOnset: v })} />
      <CheckRow label="Video output" checked={video} onChange={v => onChange({ video: v })} />
      <CheckRow label="Individual chop files" checked={individual} onChange={v => onChange({ individual: v })} />

      <label style={{ fontSize: 13 }}>
        Gap between words (ms)
        <input
          type="number" value={gapMs} min={0} step={50}
          onChange={e => onChange({ gapMs: Number(e.target.value) })}
          style={{ marginTop: 4 }}
        />
      </label>

      <SliderRow
        label="Tail buffer (ms)" value={tailBufferMs} min={0} max={300} step={10} unit="ms"
        onChange={v => onChange({ tailBufferMs: v })}
      />
      <SliderRow
        label="Gate threshold" value={onsetThresholdDb} min={-80} max={-10} step={5} unit="dB"
        onChange={v => onChange({ onsetThresholdDb: v })}
      />
    </section>
  );
}
