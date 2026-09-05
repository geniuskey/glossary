import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { aiConfig, createDb, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;
const originalEncryptionKey = process.env.GLOSSARY_ENCRYPTION_KEY;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { GET, PATCH } = await import("../src/app/api/v1/admin/ai-config/route.js");
const { POST: LIST_MODELS } = await import("../src/app/api/v1/admin/ai-config/models/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
let originalConfig: typeof aiConfig.$inferSelect | undefined;

beforeAll(async () => {
  [originalConfig] = await db.select().from(aiConfig).where(eq(aiConfig.id, "default")).limit(1);
  process.env.GLOSSARY_ENCRYPTION_KEY = "test-ai-route-encryption-key-with-at-least-32-characters";
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db.delete(aiConfig).where(eq(aiConfig.id, "default"));
  if (originalConfig) await db.insert(aiConfig).values(originalConfig);
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  if (originalEncryptionKey === undefined) delete process.env.GLOSSARY_ENCRYPTION_KEY;
  else process.env.GLOSSARY_ENCRYPTION_KEY = originalEncryptionKey;
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `ai-config-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `AI 설정 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  userIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function request(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/ai-config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function modelsRequest(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/ai-config/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validConfig = {
  enabled: true,
  provider: "openai_compatible" as const,
  baseUrl: "https://ai.example.com/v1",
  model: "company-model",
  apiKey: "plain-api-secret",
  customHeaders: [{ name: "X-Organization", value: "secret-organization" }],
};

test("AI 연결 설정은 관리자만 조회하고 변경할 수 있다", async () => {
  currentCookieValue = undefined;
  expect((await GET()).status).toBe(401);
  await loginAs("editor");
  expect((await GET()).status).toBe(403);
  expect((await PATCH(request(validConfig))).status).toBe(403);
  expect((await LIST_MODELS(modelsRequest({ provider: "gemini", baseUrl: validConfig.baseUrl, apiKey: "key", customHeaders: [] }))).status).toBe(403);
});

test("관리자는 비밀값을 암호화해 저장하고 API에서는 마스킹된 정보만 받는다", async () => {
  await loginAs("admin");
  const saved = await PATCH(request(validConfig));
  expect(saved.status).toBe(200);
  const body = await saved.json();
  expect(body.config).toMatchObject({ hasApiKey: true, customHeaders: [{ name: "X-Organization", configured: true }] });
  expect(JSON.stringify(body)).not.toContain("plain-api-secret");
  expect(JSON.stringify(body)).not.toContain("secret-organization");

  const [row] = await db.select().from(aiConfig).where(eq(aiConfig.id, "default"));
  expect(row?.apiKeyEncrypted).toMatch(/^v1\./);
  expect(row?.apiKeyEncrypted).not.toContain("plain-api-secret");
  expect(row?.customHeadersEncrypted).not.toContain("secret-organization");
});

test("저장된 비밀값은 빈 입력으로 유지되고 위험한 header는 거부한다", async () => {
  await loginAs("admin");
  const kept = await PATCH(request({ ...validConfig, apiKey: "", customHeaders: [{ name: "X-Organization", value: "" }] }));
  expect(kept.status).toBe(200);
  expect((await kept.json()).config).toMatchObject({ hasApiKey: true, customHeaders: [{ name: "X-Organization", configured: true }] });

  const blocked = await PATCH(request({ ...validConfig, customHeaders: [{ name: "Host", value: "metadata.internal" }] }));
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error.code).toBe("validation_failed");
});

test("모델 목록 조회는 새 키 또는 저장된 마스킹 값을 사용하되 저장하지 않는다", async () => {
  await loginAs("admin");
  const localConfig = { ...validConfig, baseUrl: "http://127.0.0.1:9999/v1" };
  expect((await PATCH(request(localConfig))).status).toBe(200);
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ data: [{ id: "chat-model-a" }] }));
  vi.stubGlobal("fetch", fetchMock);

  const listed = await LIST_MODELS(modelsRequest({
    provider: "openai_compatible",
    baseUrl: localConfig.baseUrl,
    customHeaders: [{ name: "X-Organization", value: "", configured: true }],
  }));
  expect(listed.status).toBe(200);
  expect((await listed.json()).models).toEqual([{ id: "chat-model-a", label: "chat-model-a" }]);
  const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
  expect(headers.get("authorization")).toBe("Bearer plain-api-secret");
  expect(headers.get("x-organization")).toBe("secret-organization");
});
