import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWavesurfer } from "@wavesurfer/react";
import type WaveSurfer from "wavesurfer.js";
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
  chop,
  isActive,
  onWsReady,
  onPlayFinished,
  onChopUpdated,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chop.index });

  const waveContainerRef = useRef<HTMLDivElement>(null);
  const { wavesurfer, isReady } = useWavesurfer({
    container: waveContainerRef,
    url: chop.url ? `${API}${chop.url}` : undefined,
    waveColor: "#4a2880",
    progressColor: "#b060f0",
    cursorColor: "#c080ff",
    height: 48,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
  });

  const [dragOffsetMs, setDragOffsetMs] = useState(0);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // reroll state
  const [showCandidates, setShowCandidates] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

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
    const list = await getCandidates(chop.word);
    setCandidates(list);
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
      onChopUpdated(
        chop.index,
        result.url + `?t=${Date.now()}`,
        result.start_sec,
        result.end_sec,
        c.source_path,
      );
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
        onChopUpdated(
          chop.index,
          result.url + `?t=${Date.now()}`,
          result.start_sec,
          result.end_sec,
          chop.source_path!,
        );
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
        width: 158,
        background: isActive ? "#23104a" : "#160c35",
        border: `1px solid ${isActive ? "#8040d0" : "#2e1860"}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        boxShadow: isActive ? "0 0 0 2px #8040d030" : undefined,
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
      onClick={() => { if (!isAdjusting && !showCandidates) wavesurfer?.playPause(); }}
    >
      {/* header */}
      <div style={{ padding: "7px 8px 4px", display: "flex", alignItems: "flex-start", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600,
            color: chop.is_tts ? "#a060a0" : "#e8e0ff",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {chop.word}
            {chop.matched_word && chop.matched_word.trim().toLowerCase() !== chop.word.toLowerCase() && (
              <span style={{ color: "#7050a0", fontSize: 10, fontWeight: 400, marginLeft: 4 }}>
                {chop.matched_word.trim()}
              </span>
            )}
          </div>
          {isAdjusting && (
            <div style={{ fontSize: 10, color: "#c080ff", fontVariantNumeric: "tabular-nums" }}>
              {dragOffsetMs > 0 ? "+" : ""}{dragOffsetMs}ms
            </div>
          )}
          {isRegenerating && (
            <div style={{ fontSize: 10, color: "#8060c0" }}>slicing…</div>
          )}
        </div>

        {/* reroll button */}
        {!chop.is_tts && chop.output_file && (
          <button
            style={{
              background: showCandidates ? "#3a1870" : "transparent",
              border: "none", borderRadius: 4, padding: "2px 4px",
              fontSize: 12, color: "#8060c0", cursor: "pointer",
              flexShrink: 0, lineHeight: 1,
            }}
            onClick={openReroll}
            title="Reroll — pick a different match"
          >
            ⟳
          </button>
        )}
      </div>

      {/* candidate picker */}
      {showCandidates && (
        <div
          style={{
            background: "#0e0828", borderTop: "1px solid #2e1860",
            maxHeight: 180, overflowY: "auto",
          }}
          onClick={e => e.stopPropagation()}
        >
          {loadingCandidates ? (
            <div style={{ padding: "8px", fontSize: 11, color: "#6040a0" }}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: "8px", fontSize: 11, color: "#6040a0" }}>No matches found</div>
          ) : (
            candidates.map((c, i) => (
              <div
                key={i}
                onClick={(e) => pickCandidate(c, e)}
                style={{
                  padding: "5px 8px", cursor: "pointer", fontSize: 11,
                  borderBottom: "1px solid #1a0e40",
                  display: "flex", flexDirection: "column", gap: 1,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#1e1048")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ color: "#e8e0ff", fontWeight: 500 }}>
                  {c.word}
                  <span style={{ color: "#8060c0", marginLeft: 6 }}>{c.score}%</span>
                </div>
                <div style={{ color: "#6040a0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.source} · {c.start_sec.toFixed(2)}s
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* waveform */}
      {!showCandidates && (
        <div
          style={{ padding: "0 6px", cursor: "pointer" }}
          onClick={e => { e.stopPropagation(); wavesurfer?.playPause(); }}
          onPointerDown={e => e.stopPropagation()}
        >
          {chop.url ? (
            <div ref={waveContainerRef} />
          ) : (
            <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#5040a0" }}>TTS</span>
            </div>
          )}
        </div>
      )}

      {/* footer hint */}
      {!showCandidates && (
        <div style={{ padding: "2px 8px 5px", fontSize: 9, color: "#5040a0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {chop.is_tts ? "text-to-speech" : canAdjust ? "shift+drag to adjust" : (chop.matched_word ?? "")}
        </div>
      )}

      {/* thumbnail */}
      {chop.thumbnail_url && !showCandidates && (
        <img
          src={`${API}${chop.thumbnail_url}`}
          style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
          draggable={false}
        />
      )}
    </div>
  );
}
