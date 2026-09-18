import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, definitionReviewSuggestions, terms, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm } from "../src/lib/terms/create.js";
import { AI_SUGGESTION_GENERATOR_VERSIONS } from "../src/lib/ai/suggestion-disposition-values.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const route = await import("../src/app/api/v1/contributions/term-definitions/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
const createdTermIds: string[] = [];

afterAll(async () => {
  for (const id of createdTermIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor" = "editor") {
  const [user] = await db.insert(users).values({
    email: `definition-review-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: role === "admin" ? "정의 승인 관리자" : "정의 승인 편집자",
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
  return user!;
}

test("본문만 있는 용어를 대기열에서 찾아 편집자가 한줄 정의를 승인한다", async () => {
  const editor = await loginAs();
  const created = await createTerm({
    nameEn: `Definition Review ${Date.now()}`,
    domain: [],
    status: "draft",
    bodyMd: "조직 내부 배포 전에 변경 사항과 영향 범위를 함께 검토하는 절차입니다.",
    surfaces: [],
  }, editor.id);
  createdTermIds.push(created.term.id);

  await db.insert(definitionReviewSuggestions).values({
    termId: created.term.id,
    revision: 1,
    generatorVersion: AI_SUGGESTION_GENERATOR_VERSIONS.definition,
    suggestion: "변경 사항과 영향 범위를 배포 전에 함께 검토하는 절차입니다.",
  });

  const queue = await route.GET(new Request("https://glossary.example.com/api/v1/contributions/term-definitions"));
  expect(queue.status).toBe(200);
  const queued = await queue.json() as { items: Array<{ id: string; revision: number; suggestion?: string | null }> };
  const candidate = queued.items.find((item) => item.id === created.term.id);
  expect(candidate?.revision).toBe(1);
  expect(candidate?.suggestion).toContain("배포 전에");

  const approved = await route.PATCH(new Request("https://glossary.example.com/api/v1/contributions/term-definitions", {
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
  const after = await route.GET(new Request("https://glossary.example.com/api/v1/contributions/term-definitions"));
  expect(((await after.json()) as { items: Array<{ id: string }> }).items.some((item) => item.id === created.term.id)).toBe(false);
});

test("이전 생성기 버전의 캐시는 현재 제안으로 표시하지 않는다", async () => {
  const editor = await loginAs();
  const created = await createTerm({
    nameEn: `Stale Definition Review ${Date.now()}`,
    domain: [],
    status: "draft",
    bodyMd: "이전 생성기가 만든 정의를 다시 검토해야 하는 절차입니다.",
    surfaces: [],
  }, editor.id);
  createdTermIds.push(created.term.id);

  await db.insert(definitionReviewSuggestions).values({
    termId: created.term.id,
    revision: 1,
    generatorVersion: AI_SUGGESTION_GENERATOR_VERSIONS.definition - 1,
    suggestion: "이전 생성기가 만든 오래된 제안입니다.",
  });

  const queue = await route.GET(new Request("https://glossary.example.com/api/v1/contributions/term-definitions"));
  expect(queue.status).toBe(200);
  const queued = await queue.json() as { items: Array<{ id: string; suggestion?: string | null }> };
  const candidate = queued.items.find((item) => item.id === created.term.id);
  expect(candidate).toBeDefined();
  expect(candidate?.suggestion).toBeNull();
});

test("한줄 정의 승인 API는 비로그인 사용자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await route.GET(new Request("https://glossary.example.com/api/v1/contributions/term-definitions"))).status).toBe(401);
});
