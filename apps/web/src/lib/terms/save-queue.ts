import type { TermRow } from "./grid";
import type { TermWriteResponse } from "./wire";

/** Keep edits in submission order, including after a rejected operation. */
export function createSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(save: () => Promise<T>): Promise<T> {
    const result = tail.then(save);
    tail = result.catch(() => undefined);
    return result;
  };
}
export function savedGridRow(before: TermRow, term: TermWriteResponse["term"], editorName: string): TermRow {
  return { ...before, ...term, topic: term.tags.join(", ") || null, revision: before.revision + 1, editorName };
}
