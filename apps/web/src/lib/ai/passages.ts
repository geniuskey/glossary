export interface Passage { text: string; start: number }

/** Exact slices, including offsets, let saved evidence survive later edits to the term. */
export function splitPassages(text: string, size = 900, overlap = 120): Passage[] {
  const result: Passage[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      if (paragraph > start + size / 2) end = paragraph;
    }
    const slice = text.slice(start, end);
    if (slice.trim()) result.push({ text: slice, start });
    if (end === text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return result;
}

export function relevantPassages(text: string | null, keywords: string[], count: number): Passage[] {
  if (!text) return [];
  return splitPassages(text).map((passage) => {
    const normalized = passage.text.normalize("NFKC").toLowerCase();
    const score = keywords.reduce((sum, word) => sum + (normalized.includes(word) ? 1 + Math.min(word.length, 10) / 10 : 0), 0);
    return { ...passage, score };
  }).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, count).sort((a, b) => a.start - b.start)
    .map(({ text: excerpt, start }) => ({ text: excerpt, start }));
}
