import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWavesurfer } from "@wavesurfer/react";
import type WaveSurfer from "wavesurfer.js";
import { ArrowsClockwise, Export } from "@phosphor-icons/react";
import { Chop } from "../types";
import { API, Candidate, getCandidates, regenerateChop } from "../api";

type Props = {
  chop: Chop;
  isActive: boolean;
  onWsReady: (chopIndex: number, ws: WaveSurfer | null) => void;
  onPlayFinished: (chopIndex: number) => void;
  onChopUpdated: (
    chopIndex: number,
    url: string,
    startSec: number,
    endSec: number,
    sourcePath: string,
  ) => void;
};

export function SampleChopCard({
  chop, isActive, onWsReady, onPlayFinished, onChopUpdated,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chop.index });

  const waveContainerRef = useRef<HTMLDivElement>(null);
  const { wavesurfer } = useWavesurfer({
    container: waveContainerRef,
    url: chop.url ? `${API}${chop.url}` : undefined,
    waveColor: "#FFCCFD",
    progressColor: "#E70BDD",
    cursorColor: "#E70BDD",
    height: 72,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
  });

  const [dragOffsetMs, setDragOffsetMs] = useState(0);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wavesurfer) return;
    onWsReady(chop.index, wavesurfer);
    wavesurfer.on("finish", () => onPlayFinished(chop.index));
    return () => { onWsReady(chop.index, null); };
  }, [wavesurfer]);

  async function openReroll(e: React.MouseEvent) {
    e.stopPropagation();
    if (showCandidates) { setShowCandidates(false); return; }
    setShowCandidates(true);
    setLoadingCandidates(true);
    setCandidates(await getCandidates(chop.word));
    setLoadingCandidates(false);
  }

  async function pickCandidate(c: Candidate, e: React.MouseEvent) {
    e.stopPropagation();
    if (!chop.output_file) return;
    setShowCandidates(false);
    setIsRegenerating(true);
    try {
      const result = await regenerateChop({
        output_file: chop.output_file,
        source_path: c.source_path,
        start_sec: c.start_sec,
        end_sec: c.end_sec,
        offset_ms: 0,
      });
      onChopUpdated(chop.index, result.url + `?t=${Date.now()}`, result.start_sec, result.end_sec, c.source_path);
    } catch {}
    setIsRegenerating(false);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.shiftKey) return;
    if (!chop.source_path || chop.is_tts || !chop.output_file) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setIsAdjusting(true);
    let finalOffset = 0;

    function onMove(ev: PointerEvent) {
      finalOffset = Math.max(-chop.margin_ms, Math.min(chop.margin_ms, Math.round(ev.clientX - startX)));
      setDragOffsetMs(finalOffset);
    }

    async function onUp() {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      setIsAdjusting(false);
      setDragOffsetMs(0);
      if (finalOffset === 0) return;
      setIsRegenerating(true);
      try {
        const result = await regenerateChop({
          output_file: chop.output_file!,
          source_path: chop.source_path!,
          start_sec: chop.start_sec!,
          end_sec: chop.end_sec!,
          offset_ms: finalOffset,
        });
        onChopUpdated(chop.index, result.url + `?t=${Date.now()}`, result.start_sec, result.end_sec, chop.source_path!);
      } catch {}
      setIsRegenerating(false);
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  const canAdjust = !chop.is_tts && !!chop.source_path && !!chop.output_file;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        flexShrink: 0,
        width: 170,
        background: isActive ? "#3a0a38" : "#2A0028",
        border: `1px solid ${isActive ? "rgba(231,11,221,0.5)" : "rgba(174,112,171,0.15)"}`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        boxShadow: isActive ? "0 0 0 2px rgba(231,11,221,0.2)" : undefined,
        position: "relative",
      }}
      {...attributes}
      onPointerDown={(e) => {
        if (e.shiftKey) {
          handlePointerDown(e);
        } else {
          listeners?.onPointerDown?.(e as any);
        }
      }}
      onKeyDown={listeners?.onKeyDown as any}
      onClick={() => {
        if (!isAdjusting && !showCandidates) wavesurfer?.playPause();
      }}
    >
      {/* header */}
      <div style={{ padding: "8px 8px 4px", display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600,
            color: chop.is_tts ? "var(--muted)" : "var(--text)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {chop.word}
          </div>
          {isAdjusting && (
            <div style={{ fontSize: 10, color: "#E70BDD", fontVariantNumeric: "tabular-nums" }}>
              {dragOffsetMs > 0 ? "+" : ""}{dragOffsetMs}ms
            </div>
          )}
          {isRegenerating && (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>slicing…</div>
          )}
        </div>

        {/* reroll */}
        {!chop.is_tts && chop.output_file && (
          <button
            style={{
              background: showCandidates ? "rgba(231,11,221,0.15)" : "transparent",
              border: "none", borderRadius: 6, padding: "3px 5px",
              color: "var(--muted)", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
            onClick={openReroll}
            onPointerDown={e => e.stopPropagation()}
            title="Pick a different sample"
          >
            <ArrowsClockwise size={13} />
          </button>
        )}
      </div>

      {/* candidate picker */}
      {showCandidates && (
        <div
          style={{ background: "#0e0620", borderTop: "1px solid rgba(174,112,171,0.15)", maxHeight: 160, overflowY: "auto" }}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          {loadingCandidates ? (
            <div style={{ padding: 8, fontSize: 11, color: "var(--muted)" }}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: 8, fontSize: 11, color: "var(--muted)" }}>No matches</div>
          ) : candidates.map((c, i) => (
            <div
              key={i}
              onClick={e => pickCandidate(c, e)}
              style={{
                padding: "5px 8px", cursor: "pointer", fontSize: 11,
                borderBottom: "1px solid rgba(174,112,171,0.08)",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(174,112,171,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ color: "var(--text)", fontWeight: 500 }}>
                {c.word} <span style={{ color: "var(--muted)" }}>{c.score}%</span>
              </div>
              <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.source} · {c.start_sec.toFixed(2)}s
              </div>
            </div>
          ))}
        </div>
      )}

      {/* waveform with slide animation */}
      {!showCandidates && (
        <div
          style={{ overflow: "hidden", cursor: "pointer" }}
          onClick={e => { e.stopPropagation(); wavesurfer?.playPause(); }}
          onPointerDown={e => e.stopPropagation()}
        >
          <div style={{
            transform: isAdjusting ? `translateX(${dragOffsetMs * 0.2}px)` : "none",
            transition: isAdjusting ? "none" : "transform 0.15s ease",
          }}>
            {chop.url ? (
              <div ref={waveContainerRef} style={{ padding: "0 0" }} />
            ) : (
              <div style={{ height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>TTS</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* footer */}
      {!showCandidates && (
        <div style={{
          padding: "3px 8px 6px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 9, color: "rgba(174,112,171,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {chop.is_tts ? "text-to-speech" : canAdjust ? "shift+drag to adjust" : (chop.matched_word ?? "")}
          </span>
          {/* Copy path for DAW import */}
          {chop.output_path && (
            <div
              onClick={async (e) => {
                e.stopPropagation();
                await navigator.clipboard.writeText(chop.output_path!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              onPointerDown={e => e.stopPropagation()}
              style={{ color: copied ? "#E70BDD" : "rgba(174,112,171,0.5)", cursor: "pointer", flexShrink: 0, display: "flex", padding: "0 2px" }}
              title="Copy file path"
            >
              <Export size={11} />
            </div>
          )}
        </div>
      )}

      {/* thumbnail */}
      {chop.thumbnail_url && !showCandidates && (
        <img
          src={`${API}${chop.thumbnail_url}`}
          style={{ width: "100%", height: 65, objectFit: "cover", display: "block" }}
          draggable={false}
        />
      )}
    </div>
  );
}
