export const API = "http://localhost:7731";

export function downloadFile(url: string, filename: string) {
  fetch(`${API}${url}`)
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    });
}

export async function regenerateChop(payload: {
  output_file: string;
  source_path: string;
  start_sec: number;
  end_sec: number;
  offset_ms: number;
}): Promise<{ url: string; start_sec: number; end_sec: number }> {
  const r = await fetch(`${API}/regenerate_chop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type Candidate = {
  word: string;
  score: number;
  probability: number;
  start_sec: number;
  end_sec: number;
  source: string;
  source_path: string;
};

export async function getCandidates(word: string, limit = 8): Promise<Candidate[]> {
  const r = await fetch(`${API}/candidates/${encodeURIComponent(word)}?threshold=40&limit=${limit}`);
  const data = await r.json();
  return data.matches ?? [];
}

export async function joinChops(payload: {
  files: string[];
  gap_ms: number;
  output_file: string;
}): Promise<{ url: string }> {
  const r = await fetch(`${API}/join_chops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
