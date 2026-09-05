import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { POST } = await import("../src/app/api/v1/terms/paste-check/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAsEditor() {
  const [user] = await db.insert(users).values({
    email: `paste-check-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: "붙여넣기 검사자",
    passwordHash: await hashPassword("irrelevant-password"),
    role: "editor",
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function request(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/terms/paste-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("붙여넣기 사전 검사는 모든 행의 오류를 한 응답에 모은다", async () => {
  await loginAsEditor();
  const response = await POST(request({
    updates: [],
    creates: [
      { line: 1, values: { nameEn: "Batch Duplicate", domain: ["존재하지 않는 도메인"] } },
      { line: 2, values: { nameEn: "BatchDuplicate", category: ["missing-category"] } },
      { line: 3, values: { nameKo: "상태 오류", status: "unknown" } },
    ],
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { ok: boolean; errors: string[] };
  expect(body.ok).toBe(false);
  expect(body.errors.some((error) => error.includes("1번째 줄 · 도메인"))).toBe(true);
  expect(body.errors.some((error) => error.includes("2번째 줄 · 업무 분류"))).toBe(true);
  expect(body.errors.some((error) => error.includes("3번째 줄 · 상태"))).toBe(true);
  expect(body.errors.some((error) => error.includes("1, 2번째 줄") && error.includes("서로 중복"))).toBe(true);
});

test("붙여넣기 사전 검사는 인증된 편집자만 사용할 수 있다", async () => {
  currentCookieValue = undefined;
  expect((await POST(request({ updates: [], creates: [] }))).status).toBe(401);
});
