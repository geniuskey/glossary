import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
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

const { POST } = await import("../src/app/api/v1/terms/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdTermIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTermIds.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
  currentCookieValue = undefined;
});

test("새 대표 표기가 기존 추가 표기와 겹치면 등록하지 않는다", async () => {
  const [user] = await db.insert(users).values({
    email: `create-route-${Date.now()}@example.com`,
    name: "생성 라우트 테스트",
    passwordHash: await hashPassword("irrelevant"),
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;

  const existing = await createTerm({
    termType: "concept",
    nameEn: "Existing Term",
    domain: [],
    status: "active",
    surfaces: [{ text: "Collision Alias", lang: "en", kind: "alias" }],
  }, user!.id);
  createdTermIds.push(existing.term.id);

  const response = await POST(new Request("http://localhost/api/v1/terms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      termType: "concept",
      nameEn: "collision-alias",
      domain: [],
      status: "draft",
      surfaces: [],
    }),
  }));
  const body = await response.json() as {
    error: { code: string; message: string; details: { fieldErrors: Record<string, string[]> } };
  };

  expect(response.status).toBe(400);
  expect(body.error.code).toBe("validation_failed");
  expect(body.error.message).toContain("등록할 수 없습니다");
  expect(body.error.details.fieldErrors.nameEn?.join(" ")).toContain(existing.term.slug);

  const rejected = await db.select({ id: terms.id }).from(terms).where(eq(terms.nameEn, "collision-alias"));
  expect(rejected).toHaveLength(0);
});
