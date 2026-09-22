import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, ragConfig, wikiPages, wikiRagDocuments, wikiRagIndexQueue } from "@glossary/db";
import { encryptAiSecret } from "../src/lib/ai/crypto.js";
import { createWikiPage } from "../src/lib/wiki/store.js";
import { processWikiRagIndexQueue } from "../src/lib/rag/wiki-indexer.js";
import { searchWikiRag } from "../src/lib/rag/wiki-search.js";
import { retrieveGlossaryContext } from "../src/lib/ai/retrieval.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const baseUrl = "http://127.0.0.1:9997/v1";
const encryptionKey = process.env.GLOSSARY_ENCRYPTION_KEY;
const testEncryptionKey = "wiki-rag-integration-encryption-key-32chars";
const wikiIds: string[] = [];
let originalConfig: typeof ragConfig.$inferSelect | undefined;

function vector(): number[] {
  return [1, ...Array.from({ length: 1_535 }, () => 0)];
}

beforeAll(async () => {
  [originalConfig] = await db.select().from(ragConfig).where(eq(ragConfig.id, "default")).limit(1);
  process.env.GLOSSARY_ENCRYPTION_KEY = testEncryptionKey;
  await db.insert(ragConfig).values({
    id: "default",
    enabled: true,
    chatEnabled: true,
    embeddingProvider: "openai_compatible",
    embeddingBaseUrl: baseUrl,
    embeddingModel: "wiki-rag-test-embedding",
    embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
    embeddingCustomHeadersEncrypted: "",
    rerankerEnabled: false,
    rerankerProvider: "cohere_compatible",
    rerankerBaseUrl: `${baseUrl}/rerank-api`,
    rerankerModel: "wiki-rag-test-reranker",
    rerankerApiKeyEncrypted: "",
    rerankerCustomHeadersEncrypted: "",
    chunkSize: 400,
    chunkOverlap: 40,
    topK: 8,
    updatedBy: null,
  }).onConflictDoUpdate({
    target: ragConfig.id,
    set: {
      enabled: true,
      chatEnabled: true,
      embeddingProvider: "openai_compatible",
      embeddingBaseUrl: baseUrl,
      embeddingModel: "wiki-rag-test-embedding",
      embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
      embeddingCustomHeadersEncrypted: "",
      rerankerEnabled: false,
      rerankerProvider: "cohere_compatible",
      rerankerBaseUrl: `${baseUrl}/rerank-api`,
      rerankerModel: "wiki-rag-test-reranker",
      rerankerApiKeyEncrypted: "",
      rerankerCustomHeadersEncrypted: "",
      chunkSize: 400,
      chunkOverlap: 40,
      topK: 8,
      updatedBy: null,
      updatedAt: new Date(),
    },
  });
});

afterAll(async () => {
  for (const id of wikiIds) await db.delete(wikiPages).where(eq(wikiPages.id, id));
  if (originalConfig) await db.insert(ragConfig).values(originalConfig).onConflictDoUpdate({ target: ragConfig.id, set: originalConfig });
  else await db.delete(ragConfig).where(eq(ragConfig.id, "default"));
  if (encryptionKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = encryptionKey;
  vi.unstubAllGlobals();
});

test("공개 위키 저장이 durable 색인·pgvector 검색과 연결된다", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: vector() })) });
    }
    throw new Error(`unexpected provider: ${String(input)}`);
  }));

  const created = await createWikiPage({
    slug: `wiki-rag-${randomUUID().slice(0, 8)}`,
    title: "출시 기준 위키",
    summary: "출시 전 확인해야 할 기준",
    content: `결정: 베타 출시를 진행한다.\n액션 아이템: 민수가 금요일까지 출시 기준을 확인한다.\n![출시 기준표](/api/v1/attachments/${"c".repeat(64)})`,
    domain: ["상품팀"],
    termIds: [],
    status: "published",
  }, null);
  wikiIds.push(created.id);

  const [queued] = await db.select().from(wikiRagIndexQueue).where(eq(wikiRagIndexQueue.wikiPageId, created.id));
  expect(queued).toMatchObject({ revision: 1, status: "queued" });
  expect(await processWikiRagIndexQueue(1)).toBe(1);
  const chunks = await db.select().from(wikiRagDocuments).where(eq(wikiRagDocuments.wikiPageId, created.id));
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.every((chunk) => chunk.revision === 1 && chunk.embedding.length === 1_536)).toBe(true);
  const [ready] = await db.select().from(wikiRagIndexQueue).where(eq(wikiRagIndexQueue.wikiPageId, created.id));
  expect(ready?.status).toBe("ready");

  const hits = await searchWikiRag("출시 기준과 액션 아이템", { topK: 5 });
  expect(hits.some((hit) => hit.wikiPageId === created.id && hit.startOffset >= 0 && hit.slug === created.slug)).toBe(true);

  const grounding = await retrieveGlossaryContext("출시 기준", 8, { includeMeetingDocuments: false });
  const wikiEvidence = grounding.evidence?.filter((item) => item.source === "wiki") ?? [];
  expect(wikiEvidence.some((item) => item.wikiPageId === created.id)).toBe(true);
  expect(wikiEvidence.flatMap((item) => item.images ?? [])).toContainEqual({
    url: `/api/v1/attachments/${"c".repeat(64)}`,
    alt: "출시 기준표",
  });

  const glossaryOnly = await retrieveGlossaryContext("출시 기준", 8, { includeMeetingDocuments: false, includeWikiDocuments: false });
  expect(glossaryOnly.evidence?.some((item) => item.source === "wiki")).toBe(false);
});
