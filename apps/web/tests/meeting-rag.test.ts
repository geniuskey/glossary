import { expect, test } from "vitest";
import { buildMeetingRagChunks, chunkMeetingText } from "../src/lib/rag/meeting-indexer.js";

test("회의록 청크는 원문 오프셋과 겹침을 보존한다", () => {
  const input = `${"결정: 첫 번째 안건을 진행한다.\n".repeat(12)}\n\n후속: 담당자는 금요일까지 확인한다.`;
  const chunks = chunkMeetingText(input, 180, 24);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.content.length <= 180)).toBe(true);
  expect(chunks.every((chunk) => input.slice(chunk.startOffset, chunk.endOffset) === chunk.content)).toBe(true);
  expect(input.slice(chunks[1]!.startOffset)).toContain(input.slice(chunks[0]!.endOffset - 24, chunks[0]!.endOffset - 10));
});

test("회의록 RAG 청크에 문서 메타데이터와 revision이 함께 들어간다", () => {
  const chunks = buildMeetingRagChunks({
    id: "meeting-1",
    title: "상품팀 주간 회의",
    meetingDate: new Date("2026-09-18T02:00:00.000Z"),
    source: "Notion",
    team: "상품팀",
    domain: ["Product"],
    content: "결정: 베타 출시를 진행한다.\n담당: 민수",
    revision: 3,
  }, { chunkSize: 400, chunkOverlap: 40 });
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatchObject({ chunkIndex: 0, startOffset: 0 });
  expect(chunks[0]!.content).toContain("회의록: 상품팀 주간 회의");
  expect(chunks[0]!.metadata).toMatchObject({ meetingDocumentId: "meeting-1", revision: 3, team: "상품팀" });
  expect(chunks[0]!.endOffset).toBeGreaterThan(chunks[0]!.startOffset);
});
