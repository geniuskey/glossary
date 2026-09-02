import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, users, workspaceSettings } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { DEFAULT_TERM_QUALITY } from "../src/lib/workspace/term-quality-values.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { GET, PATCH } = await import("../src/app/api/v1/admin/term-quality/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
let originalSetting: typeof workspaceSettings.$inferSelect | undefined;

beforeAll(async () => {
  [originalSetting] = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, "default")).limit(1);
});

afterAll(async () => {
  await db.delete(workspaceSettings).where(eq(workspaceSettings.id, "default"));
  if (originalSetting) await db.insert(workspaceSettings).values(originalSetting);
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `term-quality-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `작성 수준 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function patchRequest(body: unknown) {
  return new Request("https://grossary.example.com/api/v1/admin/term-quality", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("용어 작성 수준 API는 비로그인 사용자와 편집자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await GET()).status).toBe(401);
  await loginAs("editor");
  expect((await GET()).status).toBe(403);
  expect((await PATCH(patchRequest(DEFAULT_TERM_QUALITY))).status).toBe(403);
});

test("설정 행이 없으면 기존 동작과 같은 기본 작성 수준을 반환한다", async () => {
  await db.delete(workspaceSettings).where(eq(workspaceSettings.id, "default"));
  await loginAs("admin");
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).settings).toEqual(DEFAULT_TERM_QUALITY);
});

test("관리자는 정의와 본문의 최소 글자 수를 저장하고 다시 읽는다", async () => {
  await loginAs("admin");
  const settings = { definitionMinChars: 30, bodyMinChars: 120 };
  const saved = await PATCH(patchRequest(settings));
  expect(saved.status).toBe(200);
  expect((await saved.json()).settings).toEqual(settings);
  expect((await (await GET()).json()).settings).toEqual(settings);
});

test("작성 수준은 0~10000 정수와 정확한 필드만 받는다", async () => {
  await loginAs("admin");
  expect((await PATCH(patchRequest({ definitionMinChars: -1, bodyMinChars: 0 }))).status).toBe(400);
  expect((await PATCH(patchRequest({ definitionMinChars: 1.5, bodyMinChars: 0 }))).status).toBe(400);
  expect((await PATCH(patchRequest({ definitionMinChars: 1, bodyMinChars: 10001 }))).status).toBe(400);
  expect((await PATCH(patchRequest({ ...DEFAULT_TERM_QUALITY, extra: true }))).status).toBe(400);
});
