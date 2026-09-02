import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businessCategories, createDb, terms, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { POST } = await import("../src/app/api/v1/admin/categories/route.js");
const { DELETE } = await import("../src/app/api/v1/admin/categories/[key]/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
let categoryKey = "";
let termId = "";

afterAll(async () => {
  if (termId) await db.delete(terms).where(eq(terms.id, termId));
  if (categoryKey) await db.delete(businessCategories).where(eq(businessCategories.key, categoryKey));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `category-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `${role} category tester`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  userIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function jsonRequest(method: "POST" | "DELETE", body?: unknown) {
  return new Request("https://grossary.example.com/api/v1/admin/categories", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("일반 사용자는 한글·영문 이름을 모두 입력해 업무 분류를 추가한다", async () => {
  await loginAs("editor");
  const missingEnglish = await POST(jsonRequest("POST", { labelKo: "라우트 분류" }));
  expect(missingEnglish.status).toBe(400);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created = await POST(jsonRequest("POST", {
    labelKo: `라우트 분류 ${suffix}`,
    labelEn: `Route Category ${suffix}`,
  }));
  expect(created.status).toBe(201);
  const body = await created.json();
  categoryKey = body.category.key;
  expect(body.category).toMatchObject({
    labelKo: `라우트 분류 ${suffix}`,
    labelEn: `Route Category ${suffix}`,
  });

  const unused = await POST(jsonRequest("POST", {
    labelKo: `미사용 분류 ${suffix}`,
    labelEn: `Unused Category ${suffix}`,
  }));
  const unusedKey = (await unused.json()).category.key as string;
  const deletedUnused = await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: unusedKey }) });
  expect(deletedUnused.status).toBe(204);
});

test("사용 중인 분류는 일반 사용자 삭제를 거부하고 관리자 삭제 시 용어를 미분류로 전환한다", async () => {
  const [term] = await db.insert(terms).values({
    slug: `category-route-term-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nameEn: "Category route fixture",
    category: [categoryKey],
  }).returning({ id: terms.id });
  termId = term!.id;

  const denied = await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: categoryKey }) });
  expect(denied.status).toBe(403);
  expect((await denied.json()).error.code).toBe("forbidden");

  await loginAs("admin");
  const deleted = await DELETE(jsonRequest("DELETE"), { params: Promise.resolve({ key: categoryKey }) });
  expect(deleted.status).toBe(204);
  categoryKey = "";

  const [updatedTerm] = await db.select({ category: terms.category }).from(terms).where(eq(terms.id, termId));
  expect(updatedTerm?.category).toEqual([]);
});
