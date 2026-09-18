import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, terms, users } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: exportTerms } = await import("../src/app/api/v1/admin/exports/terms/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
let exportedTermId: string | undefined;

beforeAll(async () => {
  const [admin] = await db
    .insert(users)
    .values({
      email: `term-export-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "스냅샷 관리자",
      passwordHash: await hashPassword("irrelevant-password"),
      role: "admin",
    })
    .returning();
  createdUserIds.push(admin!.id);

  const created = await createTerm({
    nameEn: `Snapshot Probe ${Date.now()}`,
    nameKo: "스냅샷 확인 용어",
    fullNameEn: "Snapshot Probe Full Name",
    definitionMd: "스냅샷에 포함되는 정의",
    bodyMd: "스냅샷에 포함되는 본문",
    domain: [],
    category: [],
    surfaces: [{ text: "SP", lang: "en", kind: "abbreviation" }],
  }, admin!.id);
  exportedTermId = created.term.id;
});

afterAll(async () => {
  currentCookieValue = undefined;
  if (exportedTermId) await db.delete(terms).where(eq(terms.id, exportedTermId));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db
    .insert(users)
    .values({
      email: `term-export-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `스냅샷 ${role}`,
      passwordHash: await hashPassword("irrelevant-password"),
      role,
    })
    .returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

test("스냅샷 API는 비로그인 사용자와 편집자의 접근을 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await exportTerms()).status).toBe(401);

  await loginAs("editor");
  expect((await exportTerms()).status).toBe(403);
});

test("관리자는 서버 전체 용어와 표기를 읽기 전용 스냅샷으로 내려받는다", async () => {
  await loginAs("admin");

  const response = await exportTerms();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="glossary-snapshot-\d{4}-\d{2}-\d{2}\.json"/);

  const body = await response.json();
  expect(body).toMatchObject({
    format: "geniuskey.glossary.snapshot",
    version: 1,
    readOnly: true,
  });
  const term = body.data.terms.find((item: { id: string }) => item.id === exportedTermId);
  expect(term).toMatchObject({
    id: exportedTermId,
    nameEn: expect.stringContaining("Snapshot Probe"),
    currentRevision: 1,
  });
  expect(body.data.surfaces).toEqual(expect.arrayContaining([
    expect.objectContaining({ termId: exportedTermId, text: "SP", kind: "abbreviation" }),
  ]));
  expect(JSON.stringify(body)).not.toContain("passwordHash");
  expect(JSON.stringify(body)).not.toContain("apiKey");
});
