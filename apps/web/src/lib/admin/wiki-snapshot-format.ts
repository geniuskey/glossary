export const WIKI_SNAPSHOT_FORMAT = "geniuskey.wiki.snapshot";
export const WIKI_SNAPSHOT_VERSION = 1;

function isWikiSnapshotRecord(value: unknown): value is { format: string; version: number; readOnly: true } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).format === WIKI_SNAPSHOT_FORMAT &&
    (value as Record<string, unknown>).version === WIKI_SNAPSHOT_VERSION &&
    (value as Record<string, unknown>).readOnly === true,
  );
}

export function isWikiSnapshotText(text: string): boolean {
  try {
    return isWikiSnapshotRecord(JSON.parse(text));
  } catch {
    return false;
  }
}

export function isWikiSnapshotBytes(buffer: ArrayBuffer): boolean {
  return isWikiSnapshotText(new TextDecoder().decode(buffer));
}
