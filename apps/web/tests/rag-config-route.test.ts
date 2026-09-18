import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, ragConfig, ragIndexQueue, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;
const originalEncryptionKey = process.env.GLOSSARY_ENCRYPTION_KEY;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { GET, PATCH } = await import("../src/app/api/v1/admin/rag-config/route.js");
const { POST: LIST_MODELS } = await import("../src/app/api/v1/admin/rag-config/models/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
let originalConfig: typeof ragConfig.$inferSelect | undefined;

const validConfig = {
  enabled: true,
  embeddingProvider: "openai_compatible" as const,
  embeddingBaseUrl: "http://127.0.0.1:9999/v1",
  embeddingModel: "rag-embedding-test",
  embeddingApiKey: "embedding-secret",
  embeddingCustomHeaders: [{ name: "X-Tenant", value: "tenant-secret" }],
  rerankerEnabled: true,
  rerankerProvider: "cohere_compatible" as const,
  rerankerBaseUrl: "http://127.0.0.1:9999/v2",
  rerankerModel: "rag-reranker-test",
  rerankerApiKey: "reranker-secret",
  rerankerCustomHeaders: [],
  chunkSize: 800,
  chunkOverlap: 100,
  topK: 6,
};

beforeAll(async () => {
  [originalConfig] = await db.select().from(ragConfig).where(eq(ragConfig.id, "default")).limit(1);
  await db.delete(ragIndexQueue);
  process.env.GLOSSARY_ENCRYPTION_KEY = "rag-route-encryption-key-with-at-least-32-characters";
});

afterAll(async () => {
  currentCookieValue = undefined;
  await db.delete(ragIndexQueue);
  await db.delete(ragConfig).where(eq(ragConfig.id, "default"));
  if (originalConfig) await db.insert(ragConfig).values(originalConfig);
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  if (originalEncryptionKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = originalEncryptionKey;
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `rag-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `RAG 설정 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  userIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function request(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/rag-config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function modelsRequest(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/rag-config/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("RAG 설정은 관리자만 변경하고 비밀값은 암호화·마스킹한다", async () => {
  currentCookieValue = undefined;
  expect((await GET()).status).toBe(401);
  await loginAs("editor");
  expect((await GET()).status).toBe(403);
  expect((await PATCH(request(validConfig))).status).toBe(403);

  await loginAs("admin");
  const saved = await PATCH(request(validConfig));
  expect(saved.status).toBe(200);
  const body = await saved.json();
  expect(body.config).toMatchObject({
    enabled: true,
    embedding: { model: "rag-embedding-test", hasApiKey: true, customHeaders: [{ name: "X-Tenant", configured: true }] },
    reranker: { enabled: true, model: "rag-reranker-test", hasApiKey: true },
  });
  expect(JSON.stringify(body)).not.toContain("embedding-secret");
  expect(JSON.stringify(body)).not.toContain("tenant-secret");
  expect(JSON.stringify(body)).not.toContain("reranker-secret");

  const [row] = await db.select().from(ragConfig).where(eq(ragConfig.id, "default"));
  expect(row?.embeddingApiKeyEncrypted).toMatch(/^v1\./);
  expect(row?.rerankerApiKeyEncrypted).toMatch(/^v1\./);
  expect(body.queued).toBeTypeOf("number");
  expect((await db.select().from(ragIndexQueue)).length).toBe(body.queued);
});

test("RAG 설정은 위험한 header와 잘못된 청크 범위를 거부한다", async () => {
  const blocked = await PATCH(request({ ...validConfig, embeddingCustomHeaders: [{ name: "Host", value: "metadata" }] }));
  expect(blocked.status).toBe(400);
  const blockedBody = await blocked.json();
  expect(blockedBody.error.code).toBe("validation_failed");

  const badOverlap = await PATCH(request({ ...validConfig, chunkSize: 400, chunkOverlap: 400 }));
  expect(badOverlap.status).toBe(400);
  expect((await badOverlap.json()).error.details.formErrors).toEqual(expect.arrayContaining([
    expect.stringContaining("청크 겹침"),
  ]));
});

test("OpenAI-compatible RAG 모델 목록은 embed·reranker 키워드로 분류한다", async () => {
  await loginAs("admin");
  const openAiRagConfig = {
    ...validConfig,
    rerankerProvider: "openai_compatible" as const,
    rerankerBaseUrl: "http://127.0.0.1:9999/v1",
  };
  const saved = await PATCH(request(openAiRagConfig));
  expect(saved.status).toBe(200);
  expect((await saved.json()).config.reranker.provider).toBe("openai_compatible");
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ data: [
    { id: "company-llm" },
    { id: "company-embed-large" },
    { id: "company-reranker-v2" },
    { id: "company-embed-large" },
  ] }));
  vi.stubGlobal("fetch", fetchMock);

  const embedding = await LIST_MODELS(modelsRequest({
    endpoint: "embedding",
    baseUrl: "http://127.0.0.1:9999/v1",
    customHeaders: [{ name: "X-Tenant", value: "", configured: true }],
  }));
  expect(embedding.status).toBe(200);
  expect((await embedding.json()).models).toEqual([{ id: "company-embed-large", label: "company-embed-large" }]);

  const reranker = await LIST_MODELS(modelsRequest({
    endpoint: "reranker",
    baseUrl: "http://127.0.0.1:9999/v1",
    customHeaders: [],
  }));
  expect(reranker.status).toBe(200);
  expect((await reranker.json()).models).toEqual([{ id: "company-reranker-v2", label: "company-reranker-v2" }]);
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:9999/v1/models");
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer embedding-secret");
  expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer reranker-secret");
});
