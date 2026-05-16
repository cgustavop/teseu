export type Chop = {
  index: number;
  word: string;
  matched_word: string | null;
  is_tts: boolean;
  url: string | null;
  output_file: string | null;
  source_path: string | null;
  start_sec: number | null;
  end_sec: number | null;
  thumbnail_url: string | null;
  margin_ms: number;
};

export type GenerateResult = {
  phrase_slug: string;
  joined_file: string | null;
  joined_url: string | null;
  chops: Chop[];
};

export type IndexProgress = {
  type: string;
  file?: string;
  done?: number;
  total?: number;
  status?: string;
  words?: number;
  low_conf?: number;
  error?: string;
  errors?: number;
};

export type Stats = { files: number; words: number; vocab: number };

export type GenerateOptions = {
  gapMs: number;
  useOnset: boolean;
  tailBufferMs: number;
  onsetThresholdDb: number;
  video: boolean;
  individual: boolean;
};
