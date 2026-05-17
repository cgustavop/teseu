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

export async function checkWords(words: string[]): Promise<Record<string, boolean>> {
  if (!words.length) return {};
  const r = await fetch(`${API}/check_words`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(words),
  });
  return r.json();
}

export async function getSuggestions(partial: string, limit = 5): Promise<string[]> {
  if (partial.length < 2) return [];
  const r = await fetch(`${API}/suggest/${encodeURIComponent(partial)}?limit=${limit}`);
  const data = await r.json();
  return data.words ?? [];
}

export async function getFolders() {
  const r = await fetch(`${API}/folders`);
  return r.json();
}

export async function setFolderEnabled(id: number, enabled: boolean) {
  await fetch(`${API}/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteFolder(id: number) {
  await fetch(`${API}/folders/${id}`, { method: "DELETE" });
}

export async function updateFolders(): Promise<{ job_id: string; new_files: number }> {
  const r = await fetch(`${API}/folders/update`, { method: "POST" });
  return r.json();
}

export async function getRandomWords(count = 6): Promise<string[]> {
  const r = await fetch(`${API}/random_words?count=${count}`);
  const data = await r.json();
  return data.words ?? [];
}

export async function copyToClipboard(files: string[]): Promise<void> {
  await fetch(`${API}/copy_to_clipboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
}

export async function exportSession(files: string[]): Promise<string | null> {
  try {
    const r = await fetch(`${API}/export_session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.path ?? null;
  } catch {
    return null;
  }
}
