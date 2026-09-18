import { expect, test } from "vitest";
import {
  GLOSSARY_SNAPSHOT_FORMAT,
  GLOSSARY_SNAPSHOT_VERSION,
  isGlossarySnapshotBytes,
  isGlossarySnapshotText,
} from "../src/lib/admin/term-snapshot-format.js";

const snapshot = {
  format: GLOSSARY_SNAPSHOT_FORMAT,
  version: GLOSSARY_SNAPSHOT_VERSION,
  readOnly: true,
  data: { terms: [] },
};

test("관리자 스냅샷 표식은 전체 JSON과 multipart 시작부에서 식별된다", () => {
  const text = JSON.stringify(snapshot);
  expect(isGlossarySnapshotText(text)).toBe(true);
  expect(isGlossarySnapshotBytes(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(true);
});

test("일반 엑셀 임포트의 오인 차단을 위해 다른 JSON과 xlsx 바이너리는 스냅샷으로 보지 않는다", () => {
  expect(isGlossarySnapshotText(JSON.stringify({ ...snapshot, version: 2 }))).toBe(false);
  expect(isGlossarySnapshotText(JSON.stringify({ format: "other", version: 1 }))).toBe(false);
  expect(isGlossarySnapshotBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer as ArrayBuffer)).toBe(false);
});
