import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, meetingDocuments, meetingRagDocuments, meetingRagIndexQueue, ragConfig } from "@glossary/db";
import { encryptAiSecret } from "../src/lib/ai/crypto.js";
import { createMeetingDocument } from "../src/lib/meetings/store.js";
import { processMeetingRagIndexQueue } from "../src/lib/rag/meeting-indexer.js";
import { searchMeetingRag } from "../src/lib/rag/meeting-search.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const baseUrl = "http://127.0.0.1:9998/v1";
const encryptionKey = process.env.GLOSSARY_ENCRYPTION_KEY;
const testEncryptionKey = "meeting-rag-integration-encryption-key-32chars";
const meetingIds: string[] = [];
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
    embeddingModel: "meeting-rag-test-embedding",
    embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
    embeddingCustomHeadersEncrypted: "",
    rerankerEnabled: false,
    rerankerProvider: "cohere_compatible",
    rerankerBaseUrl: `${baseUrl}/rerank-api`,
    rerankerModel: "meeting-rag-test-reranker",
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
      embeddingModel: "meeting-rag-test-embedding",
      embeddingApiKeyEncrypted: encryptAiSecret("embedding-test-key"),
      embeddingCustomHeadersEncrypted: "",
      rerankerEnabled: false,
      rerankerProvider: "cohere_compatible",
      rerankerBaseUrl: `${baseUrl}/rerank-api`,
      rerankerModel: "meeting-rag-test-reranker",
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
  for (const id of meetingIds) await db.delete(meetingDocuments).where(eq(meetingDocuments.id, id));
  if (originalConfig) await db.insert(ragConfig).values(originalConfig).onConflictDoUpdate({ target: ragConfig.id, set: originalConfig });
  else await db.delete(ragConfig).where(eq(ragConfig.id, "default"));
  if (encryptionKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = encryptionKey;
  vi.unstubAllGlobals();
});

test("회의록 저장이 durable 색인·pgvector 검색과 연결된다", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: vector() })) });
    }
    throw new Error(`unexpected provider: ${String(input)}`);
  }));

  const created = await createMeetingDocument({
    title: `회의록 검색 통합 ${randomUUID()}`,
    meetingDate: new Date("2026-09-18T02:00:00.000Z"),
    source: "test",
    team: "상품팀",
    domain: ["QA"],
    content: "결정: 베타 출시를 진행한다.\n액션 아이템: 민수가 금요일까지 출시 기준을 확인한다.",
  }, null);
  meetingIds.push(created.id);

  const [queued] = await db.select().from(meetingRagIndexQueue).where(eq(meetingRagIndexQueue.meetingDocumentId, created.id));
  expect(queued).toMatchObject({ revision: 1, status: "queued" });
  expect(await processMeetingRagIndexQueue(1)).toBe(1);
  const chunks = await db.select().from(meetingRagDocuments).where(eq(meetingRagDocuments.meetingDocumentId, created.id));
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.every((chunk) => chunk.revision === 1 && chunk.embedding.length === 1_536)).toBe(true);
  const [ready] = await db.select().from(meetingRagIndexQueue).where(eq(meetingRagIndexQueue.meetingDocumentId, created.id));
  expect(ready?.status).toBe("ready");

  const hits = await searchMeetingRag("지난 회의 출시 기준과 액션 아이템", { topK: 5 });
  expect(hits.some((hit) => hit.meetingDocumentId === created.id && hit.startOffset >= 0)).toBe(true);
});
