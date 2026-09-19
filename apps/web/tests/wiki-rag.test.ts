import { expect, test } from "vitest";
import { buildWikiRagChunks, chunkWikiText } from "../src/lib/rag/wiki-indexer.js";

test("위키 청크는 본문 원문 offset을 보존한다", () => {
  const source = "첫 문단입니다.\n\n두 번째 문단에는 운영 기준과 담당자가 있습니다.\n세 번째 줄입니다.";
  const chunks = chunkWikiText(source, 32, 8);

  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    expect(source.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
    expect(chunk.endOffset).toBeLessThanOrEqual(source.length);
  }
  expect(chunks[0]!.startOffset).toBe(0);
  expect(chunks.at(-1)!.endOffset).toBe(source.length);
});

test("위키 RAG 청크에는 문서·주소·연결 용어 메타데이터가 포함된다", () => {
  const chunks = buildWikiRagChunks({
    id: "wiki-page-id",
    slug: "release-guide",
    title: "출시 가이드",
    summary: "출시 전 확인 항목",
    domain: ["상품"],
    content: "출시 기준을 확인하고 담당자를 지정합니다.",
    revision: 3,
  }, { chunkSize: 120, chunkOverlap: 10 });

  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatchObject({
    chunkIndex: 0,
    startOffset: 0,
    endOffset: "출시 기준을 확인하고 담당자를 지정합니다.".length,
    metadata: {
      wikiPageId: "wiki-page-id",
      slug: "release-guide",
      title: "출시 가이드",
      revision: 3,
      termTitles: [],
    },
  });
  expect(chunks[0]!.content).toContain("주소: /w/release-guide");
});
