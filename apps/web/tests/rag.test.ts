import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createDb, ragConfig, ragDocuments, ragIndexQueue, terms } from "@glossary/db";
import { encryptAiSecret } from "../src/lib/ai/crypto.js";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";
import { chunkRagText, processRagIndexQueue } from "../src/lib/rag/indexer.js";
import { embedTexts, rerankTexts } from "../src/lib/rag/provider.js";
import { searchRag } from "../src/lib/rag/search.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const encryptionKey = process.env.GLOSSARY_ENCRYPTION_KEY;
const testEncryptionKey = "rag-integration-encryption-key-with-at-least-32-characters";
const testBaseUrl = "http://127.0.0.1:9999/v1";
const termIds: string[] = [];
let originalConfig: typeof ragConfig.$inferSelect | undefined;

function vector(seed = 1): number[] {
  return [seed, ...Array.from({ length: 1_535 }, () => 0)];
}

function embeddingResponse(input: unknown): Response {
  const values = Array.isArray(input) ? input : [input];
  return Response.json({ data: values.map((_, index) => ({ index, embedding: vector(index === 0 ? 1 : 1) })) });
}

beforeAll(async () => {
  [originalConfig] = await db.select().from(ragConfig).where(eq(ragConfig.id, "default")).limit(1);
  process.env.GLOSSARY_ENCRYPTION_KEY = testEncryptionKey;
  // Other integration tests create terms while RAG is disabled. Clear only
  // their derived test artifacts so this file can deterministically claim its
  // own queue entry; the terms themselves remain untouched.
  await db.delete(ragDocuments);
  await db.delete(ragIndexQueue);
  await db.insert(ragConfig).values({
    id: "default",
    enabled: true,
    embeddingProvider: "openai_compatible",
    embeddingBaseUrl: testBaseUrl,
    embeddingModel: "rag-test-embedding",
    embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
    embeddingCustomHeadersEncrypted: "",
    rerankerEnabled: false,
    rerankerProvider: "cohere_compatible",
    rerankerBaseUrl: "http://127.0.0.1:9999/rerank-api",
    rerankerModel: "rag-test-reranker",
    rerankerApiKeyEncrypted: "",
    rerankerCustomHeadersEncrypted: "",
    chunkSize: 400,
    chunkOverlap: 0,
    topK: 8,
    updatedBy: null,
  }).onConflictDoUpdate({
    target: ragConfig.id,
    set: {
      enabled: true,
      embeddingProvider: "openai_compatible",
      embeddingBaseUrl: testBaseUrl,
      embeddingModel: "rag-test-embedding",
      embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
      embeddingCustomHeadersEncrypted: "",
      rerankerEnabled: false,
      rerankerProvider: "cohere_compatible",
      rerankerBaseUrl: "http://127.0.0.1:9999/rerank-api",
      rerankerModel: "rag-test-reranker",
      rerankerApiKeyEncrypted: "",
      rerankerCustomHeadersEncrypted: "",
      chunkSize: 400,
      chunkOverlap: 0,
      topK: 8,
      updatedBy: null,
      updatedAt: new Date(),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  if (termIds.length > 0) await db.delete(terms).where(eq(terms.id, termIds[0]!));
  await db.delete(ragConfig).where(eq(ragConfig.id, "default"));
  if (originalConfig) await db.insert(ragConfig).values(originalConfig);
  if (encryptionKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = encryptionKey;
});

test("청크 분할은 경계를 우선하고 겹침을 유지한다", () => {
  const chunks = chunkRagText(`${"첫 문단입니다.\n".repeat(45)}\n\n두 번째 문단의 끝입니다.`, 400, 40);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 400)).toBe(true);
  expect(chunks[1]).toContain(chunks[0]!.slice(-20));
});

test("OpenAI-compatible Embedding과 Reranker 응답을 안전하게 해석한다", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/embeddings")) return embeddingResponse(JSON.parse(String(init?.body)).input);
    return Response.json({ results: [{ index: 1, relevance_score: 0.91 }, { index: 0, relevance_score: 0.21 }] });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(embedTexts({
    provider: "openai_compatible",
    baseUrl: testBaseUrl,
    model: "embedding-test",
    apiKey: "embedding-key",
    customHeaders: [{ name: "X-Tenant", value: "glossary" }],
    dimensions: 1_536,
  }, ["하나", "둘"])).resolves.toHaveLength(2);
  await expect(rerankTexts({
    provider: "cohere_compatible",
    baseUrl: "http://127.0.0.1:9999/v2",
    model: "rerank-test",
    apiKey: "rerank-key",
    customHeaders: [],
  }, "질문", ["문서 A", "문서 B"])).resolves.toEqual([
    { index: 1, score: 0.91 },
    { index: 0, score: 0.21 },
  ]);

  const [embeddingUrl, embeddingInit] = fetchMock.mock.calls[0]!;
  expect(embeddingUrl).toBe(`${testBaseUrl}/embeddings`);
  expect(new Headers(embeddingInit?.headers).get("authorization")).toBe("Bearer embedding-key");
  expect(JSON.parse(String(embeddingInit?.body))).toMatchObject({ model: "embedding-test", dimensions: 1_536 });
});

test("용어 저장이 최신 리비전 대기열을 만들고 pgvector 색인·검색까지 연결한다", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/embeddings")) return embeddingResponse(JSON.parse(String(init?.body)).input);
    throw new Error(`unexpected provider: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const created = await createTerm({
    nameEn: `RagIntegration-${randomUUID().replaceAll("-", "")}`,
    nameKo: "RAG 통합 테스트 용어",
    fullNameEn: "Retrieval Augmented Generation Integration Probe",
    definitionMd: "pgvector 기반 의미 검색의 통합 테스트를 위한 정의입니다.",
    bodyMd: "Embedding API로 만든 벡터가 최신 리비전과 함께 저장되어야 합니다.",
    domain: ["QA"],
    surfaces: [{ text: "RAG 통합 별칭", lang: "ko", kind: "alias" }],
  }, null);
  termIds.push(created.term.id);

  const [queued] = await db.select().from(ragIndexQueue).where(eq(ragIndexQueue.termId, created.term.id));
  expect(queued).toMatchObject({ revision: 1, status: "queued" });
  expect(await processRagIndexQueue(1)).toBe(1);

  const documents = await db.select().from(ragDocuments).where(eq(ragDocuments.termId, created.term.id));
  expect(documents.length).toBeGreaterThanOrEqual(3);
  expect(documents.every((document) => document.revision === 1 && document.content.length <= 400 && document.embedding.length === 1_536)).toBe(true);
  const [ready] = await db.select().from(ragIndexQueue).where(eq(ragIndexQueue.termId, created.term.id));
  expect(ready?.status).toBe("ready");

  const hits = await searchRag("벡터 의미 검색 통합 테스트", { topK: 5 });
  expect(hits.some((hit) => hit.termId === created.term.id)).toBe(true);

  const updated = await updateTerm(created.term.id, { bodyMd: "최신 리비전의 RAG 본문입니다." }, null, 1);
  expect("term" in updated).toBe(true);
  expect(await processRagIndexQueue(1)).toBe(1);
  const latestDocuments = await db.select().from(ragDocuments).where(eq(ragDocuments.termId, created.term.id));
  expect(latestDocuments.length).toBeGreaterThanOrEqual(2);
  expect(latestDocuments.every((document) => document.revision === 2)).toBe(true);
});
