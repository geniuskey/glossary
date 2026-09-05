import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { aiConfig, aiReviewQueue, createDb, terms, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm } from "../src/lib/terms/create.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const route = await import("../src/app/api/v1/contributions/review-queue/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
let originalConfig: typeof aiConfig.$inferSelect | undefined;
let userId = "";
let termId = "";

beforeAll(async () => {
  [originalConfig] = await db.select().from(aiConfig).where(eq(aiConfig.id, "default")).limit(1);
  await db.insert(aiConfig).values({
    id: "default",
    enabled: true,
    autoReviewEnabled: false,
    provider: "openai_compatible",
    baseUrl: "https://ai.example.com/v1",
    model: "test-model",
  }).onConflictDoUpdate({
    target: aiConfig.id,
    set: { enabled: true, autoReviewEnabled: false, provider: "openai_compatible", baseUrl: "https://ai.example.com/v1", model: "test-model", apiKeyEncrypted: "", customHeadersEncrypted: "" },
  });
  const [user] = await db.insert(users).values({
    email: `review-queue-${Date.now()}@example.com`,
    name: "검토 큐 사용자",
    passwordHash: await hashPassword("irrelevant-password"),
    role: "editor",
  }).returning();
  userId = user!.id;
  currentCookieValue = (await createSession(userId)).token;
  const created = await createTerm({
    nameEn: `ManualReviewQueue${Date.now()}`,
    bodyMd: "수동 검토 큐 요청을 검증하기 위한 충분한 길이의 본문입니다.",
    domain: [],
    status: "draft",
    surfaces: [],
  }, userId);
  termId = created.term.id;
});

afterAll(async () => {
  if (termId) await db.delete(terms).where(eq(terms.id, termId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  await db.delete(aiConfig).where(eq(aiConfig.id, "default"));
  if (originalConfig) await db.insert(aiConfig).values(originalConfig);
});

test("일반 사용자가 자동 검토가 꺼진 상태에서도 수동 검토를 큐에 넣고 조회한다", async () => {
  const response = await route.POST(new Request("https://glossary.example.com/api/v1/contributions/review-queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ termId, revision: 1 }),
  }));
  expect(response.status).toBe(202);

  const [queued] = await db.select().from(aiReviewQueue).where(eq(aiReviewQueue.termId, termId));
  expect(queued).toMatchObject({ revision: 1, status: "queued", requestMode: "manual", requestedBy: userId });

  const listed = await route.GET(new Request("https://glossary.example.com/api/v1/contributions/review-queue"));
  expect(listed.status).toBe(200);
  const body = await listed.json() as { queue: { counts: { total: number }; items: Array<{ termId: string }> } };
  expect(body.queue.counts.total).toBeGreaterThanOrEqual(1);
  expect(body.queue.items.some((item) => item.termId === termId)).toBe(true);
});

test("검토 큐는 로그인하지 않은 요청에 공개되지 않는다", async () => {
  currentCookieValue = undefined;
  expect((await route.GET(new Request("https://glossary.example.com/api/v1/contributions/review-queue"))).status).toBe(401);
});
