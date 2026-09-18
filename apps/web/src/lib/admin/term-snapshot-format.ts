export const GLOSSARY_SNAPSHOT_FORMAT = "geniuskey.glossary.snapshot";
export const GLOSSARY_SNAPSHOT_VERSION = 1;

function isSnapshotRecord(value: unknown): value is { format: string; version: number; readOnly?: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.format === GLOSSARY_SNAPSHOT_FORMAT && record.version === GLOSSARY_SNAPSHOT_VERSION;
}

/**
 * 일반 엑셀 임포트로 되돌려 넣을 수 없는 관리자 스냅샷인지 판별한다.
 * 전체 JSON을 파싱할 수 있을 때는 테스트·도구에서 쓰기 좋게 엄격하게 확인한다.
 */
export function isGlossarySnapshotText(text: string): boolean {
  try {
    return isSnapshotRecord(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * multipart 본문을 xlsx 파서에 넘기기 전에 스냅샷 표식을 확인한다.
 * 파일 전체를 다시 문자열로 만들지 않고 JSON 시작부만 읽는다 — xlsx 바이너리는
 * `{`로 시작하지 않으므로 정상 엑셀 파일을 오인하지 않는다.
 */
export function isGlossarySnapshotBytes(buffer: ArrayBuffer): boolean {
  const prefix = new TextDecoder().decode(new Uint8Array(buffer).subarray(0, 8192)).trimStart();
  if (!prefix.startsWith("{")) return false;
  return new RegExp(`"format"\\s*:\\s*"${GLOSSARY_SNAPSHOT_FORMAT}"`).test(prefix)
    && new RegExp(`"version"\\s*:\\s*${GLOSSARY_SNAPSHOT_VERSION}(?:\\s*[,}])`).test(prefix);
}
