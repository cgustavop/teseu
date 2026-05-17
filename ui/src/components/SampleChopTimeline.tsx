import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type WaveSurfer from "wavesurfer.js";
import { Play, Stop } from "@phosphor-icons/react";
import { Chop } from "../types";
import { joinChops } from "../api";
import { SampleChopCard } from "./SampleChopCard";

type Props = {
  chops: Chop[];
  gapMs: number;
  joinedFile: string | null;
  onChopsChange: (chops: Chop[]) => void;
  onRebaked: (url: string) => void;
};

class ShiftAwarePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
        !nativeEvent.shiftKey,
    },
  ];
}

export function SampleChopTimeline({ chops, gapMs, joinedFile, onChopsChange, onRebaked }: Props) {
  const wsMap = useRef<Map<number, WaveSurfer>>(new Map());
  const orderedRef = useRef<Chop[]>(chops);
  const [activeChopIndex, setActiveChopIndex] = useState<number | null>(null);
  const [isGlobalPlaying, setIsGlobalPlaying] = useState(false);
  const isGlobalPlayingRef = useRef(false);
  const [rebaking, setRebaking] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { orderedRef.current = chops; }, [chops]);
  useEffect(() => { isGlobalPlayingRef.current = isGlobalPlaying; }, [isGlobalPlaying]);

  const sensors = useSensors(useSensor(ShiftAwarePointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = chops.findIndex(c => c.index === active.id);
    const newIdx = chops.findIndex(c => c.index === over.id);
    onChopsChange(arrayMove(chops, oldIdx, newIdx));
    setDirty(true);
  }

  function handleWsReady(chopIndex: number, ws: WaveSurfer | null) {
    if (ws) wsMap.current.set(chopIndex, ws);
    else wsMap.current.delete(chopIndex);
  }

  function handlePlayFinished(finishedChopIndex: number) {
    if (!isGlobalPlayingRef.current) return;
    const ordered = orderedRef.current;
    const pos = ordered.findIndex(c => c.index === finishedChopIndex);
    if (pos < ordered.length - 1) {
      const next = ordered[pos + 1];
      setActiveChopIndex(next.index);
      const ws = wsMap.current.get(next.index);
      if (ws) { ws.seekTo(0); ws.play(); }
    } else {
      setActiveChopIndex(null);
      setIsGlobalPlaying(false);
    }
  }

  function playAll() {
    if (!chops.length) return;
    const first = chops[0];
    const ws = wsMap.current.get(first.index);
    setActiveChopIndex(first.index);
    setIsGlobalPlaying(true);
    if (ws) { ws.seekTo(0); ws.play(); }
  }

  function stopAll() {
    wsMap.current.forEach(ws => { try { ws.pause(); ws.seekTo(0); } catch {} });
    setActiveChopIndex(null);
    setIsGlobalPlaying(false);
  }

  async function rebake() {
    if (!joinedFile) return;
    const files = chops.map(c => c.output_file).filter(Boolean) as string[];
    if (!files.length) return;
    setRebaking(true);
    try {
      const { url } = await joinChops({ files, gap_ms: gapMs, output_file: joinedFile });
      onRebaked(url);
      setDirty(false);
    } catch {}
    setRebaking(false);
  }

  function handleChopUpdated(
    chopIndex: number,
    url: string,
    startSec: number,
    endSec: number,
    sourcePath: string,
  ) {
    const newChops = chops.map(c =>
      c.index === chopIndex
        ? { ...c, url, start_sec: startSec, end_sec: endSec, source_path: sourcePath }
        : c
    );
    onChopsChange(newChops);
    setDirty(true);

    if (joinedFile) {
      const files = newChops.map(c => c.output_file).filter(Boolean) as string[];
      joinChops({ files, gap_ms: gapMs, output_file: joinedFile })
        .then(({ url: newUrl }) => { onRebaked(newUrl); setDirty(false); })
        .catch(() => {});
    }
  }

  if (!chops.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={isGlobalPlaying ? stopAll : playAll}
          style={{
            background: isGlobalPlaying ? "rgba(231,11,221,0.15)" : "var(--accent-gradient)",
            border: isGlobalPlaying ? "1px solid rgba(231,11,221,0.3)" : "none",
            borderRadius: 20,
            padding: "5px 14px",
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            fontWeight: 600,
            userSelect: "none",
          }}
        >
          {isGlobalPlaying
            ? <><Stop size={11} weight="fill" /> Stop</>
            : <><Play size={11} weight="fill" /> Play all</>
          }
        </button>

        {joinedFile && dirty && (
          <button
            onClick={rebake}
            disabled={rebaking}
            style={{
              background: "transparent",
              border: "1px solid rgba(174,112,171,0.25)",
              borderRadius: 20,
              padding: "5px 12px",
              color: "var(--muted)",
              cursor: rebaking ? "not-allowed" : "pointer",
              fontSize: 11,
              userSelect: "none",
            }}
          >
            {rebaking ? "Re-baking…" : "Re-bake"}
          </button>
        )}

        <span style={{ fontSize: 10, color: "rgba(174,112,171,0.4)", marginLeft: "auto", userSelect: "none" }}>
          {chops.length} chops
        </span>
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={chops.map(c => c.index)} strategy={horizontalListSortingStrategy}>
            <div style={{ display: "flex", gap: 8, minWidth: "max-content" }}>
              {chops.map(chop => (
                <SampleChopCard
                  key={chop.index}
                  chop={chop}
                  isActive={activeChopIndex === chop.index}
                  onWsReady={handleWsReady}
                  onPlayFinished={handlePlayFinished}
                  onChopUpdated={handleChopUpdated}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
