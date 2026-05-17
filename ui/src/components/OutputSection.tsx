import { Chop } from "../types";
import { API } from "../api";
import { SampleChopTimeline } from "./SampleChopTimeline";

type Props = {
  chops: Chop[];
  onChopsChange: (chops: Chop[]) => void;
  gapMs: number;
  joinedFile: string | null;
  isVideo: boolean;
  onRebaked: (url: string) => void;
};

export function OutputSection({ chops, onChopsChange, gapMs, joinedFile, isVideo, onRebaked }: Props) {
  return (
    <SampleChopTimeline
      chops={chops}
      gapMs={gapMs}
      joinedFile={joinedFile}
      onChopsChange={onChopsChange}
      onRebaked={onRebaked}
    />
  );
}
