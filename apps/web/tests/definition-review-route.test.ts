import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, terms, users } from "@glossary/db";
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

const route = await import("../src/app/api/v1/admin/term-definitions/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
const createdTermIds: string[] = [];

afterAll(async () => {
  for (const id of createdTermIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAsAdmin() {
  const [user] = await db.insert(users).values({
    email: `definition-review-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: "정의 승인 관리자",
    passwordHash: await hashPassword("irrelevant-password"),
    role: "admin",
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
  return user!;
}

test("본문만 있는 용어를 대기열에서 찾아 관리자가 한줄 정의를 승인한다", async () => {
  const admin = await loginAsAdmin();
  const created = await createTerm({
    termType: "concept",
    nameEn: `Definition Review ${Date.now()}`,
    domain: [],
    status: "draft",
    bodyMd: "조직 내부 배포 전에 변경 사항과 영향 범위를 함께 검토하는 절차입니다.",
    surfaces: [],
  }, admin.id);
  createdTermIds.push(created.term.id);

  const queue = await route.GET();
  expect(queue.status).toBe(200);
  const queued = await queue.json() as { items: Array<{ id: string; revision: number }> };
  const candidate = queued.items.find((item) => item.id === created.term.id);
  expect(candidate?.revision).toBe(1);

  const approved = await route.PATCH(new Request("https://glossary.example.com/api/v1/admin/term-definitions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      termId: created.term.id,
      definitionMd: "변경 사항과 영향 범위를 배포 전에 함께 검토하는 조직 내부 절차입니다.",
      expectedRevision: 1,
    }),
  }));
  expect(approved.status).toBe(200);
  const [saved] = await db.select({ definitionMd: terms.definitionMd }).from(terms).where(eq(terms.id, created.term.id));
  expect(saved?.definitionMd).toContain("배포 전에");
  const after = await route.GET();
  expect(((await after.json()) as { items: Array<{ id: string }> }).items.some((item) => item.id === created.term.id)).toBe(false);
});

test("한줄 정의 승인 API는 비로그인 사용자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await route.GET()).status).toBe(401);
});
