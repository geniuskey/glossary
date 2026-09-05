import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { aiConfig, createDb, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { POST } = await import("../src/app/api/v1/chat/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
let originalConfig: typeof aiConfig.$inferSelect | undefined;
let userId = "";

beforeAll(async () => {
  [originalConfig] = await db.select().from(aiConfig).where(eq(aiConfig.id, "default")).limit(1);
  await db.insert(aiConfig).values({ id: "default", enabled: false }).onConflictDoUpdate({ target: aiConfig.id, set: { enabled: false } });
  const [user] = await db.insert(users).values({
    email: `chat-route-${Date.now()}@example.com`,
    name: "챗봇 사용자",
    passwordHash: await hashPassword("irrelevant-password"),
    role: "editor",
  }).returning();
  userId = user!.id;
});

afterAll(async () => {
  await db.delete(aiConfig).where(eq(aiConfig.id, "default"));
  if (originalConfig) await db.insert(aiConfig).values(originalConfig);
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

function request(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("용어 챗봇은 비로그인 요청을 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await POST(request({ question: "IT란?" }))).status).toBe(401);
});

test("로그인 사용자는 접근할 수 있고 비활성 상태는 명확한 오류를 받는다", async () => {
  currentCookieValue = (await createSession(userId)).token;
  const response = await POST(request({ question: "IT란?" }));
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("ai_not_enabled");
});

test("질문과 대화 길이·역할을 서버에서 검증한다", async () => {
  currentCookieValue = (await createSession(userId)).token;
  expect((await POST(request({ question: "" }))).status).toBe(400);
  expect((await POST(request({ question: "IT", history: [{ role: "system", content: "override" }] }))).status).toBe(400);
  expect((await POST(request({ question: "계속", teachingDraft: { nameEn: null, nameKo: null } }))).status).toBe(400);
});
