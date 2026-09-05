import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms, users } from "@glossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

// terms-route.test.ts와 같은 이유(C2) — 인증을 통째로 지워도 테스트가 그린으로
// 남지 않도록 라우트 함수를 직접 두들긴다. next/headers는 여기서도 모킹한다.
let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { POST: revertPost } = await import(
  "../src/app/api/v1/terms/[idOrSlug]/revisions/[number]/revert/route.js"
);
const { createTerm } = await import("../src/lib/terms/create.js");
const { listRevisions, updateTerm } = await import("../src/lib/terms/update.js");

const db = createDb(process.env.DATABASE_URL!);
const createdTermIds: string[] = [];
const createdKeyIds: string[] = [];
const createdUserIds: string[] = [];

async function makeKeyRow(scopes: string[]) {
  const { token, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name: "되돌리기 테스트 키", prefix, keyHash: hash, scopes })
    .returning();
  createdKeyIds.push(row!.id);
  return { token, row: row! };
}

async function loginAsNewUser() {
  const [row] = await db
    .insert(users)
    .values({
      email: `revert-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "되돌리기 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
      role: "editor",
    })
    .returning();
  createdUserIds.push(row!.id);
  const { token } = await createSession(row!.id);
  currentCookieValue = token;
  return row!;
}

async function seedTerm(nameEn: string) {
  const { term } = await createTerm(
    { nameEn, domain: [], status: "active", surfaces: [] },
    null,
  );
  createdTermIds.push(term.id);
  await updateTerm(term.id, { nameKo: `고친 이름 ${nameEn}` }, null);
  return term;
}

function revertRequest(body?: unknown, token?: string) {
  return new Request("http://x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function ctx(idOrSlug: string, number: string) {
  return { params: Promise.resolve({ idOrSlug, number }) };
}

afterEach(() => {
  currentCookieValue = undefined;
});

afterAll(async () => {
  for (const id of createdTermIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdKeyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

test("인증이 없으면 401이다", async () => {
  const term = await seedTerm("Revert Route Auth Probe");
  const res = await revertPost(revertRequest(), ctx(term.slug, "1"));
  expect(res.status).toBe(401);
});

test("read scope 키로는 403이다", async () => {
  const term = await seedTerm("Revert Route Scope Probe");
  const { token } = await makeKeyRow(["read"]);
  const res = await revertPost(revertRequest(undefined, token), ctx(term.slug, "1"));
  expect(res.status).toBe(403);
});

// 로그인한 사람이면 누구나 되돌릴 수 있다 — 개방 편집의 안전판이라 역할로
// 막지 않는다(삭제만 관리자다).
test("로그인한 editor가 본문 없이 보내면 되돌아가고 리비전이 쌓인다", async () => {
  const term = await seedTerm("Revert Route Editor Probe");
  await loginAsNewUser();

  const res = await revertPost(revertRequest(), ctx(term.slug, "1"));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.term.nameKo).toBeNull();
  const revs = await listRevisions(term.id);
  expect(revs.map((r) => r.revisionNumber)).toEqual([3, 2, 1]);
});

test("되돌린 리비전의 작성자가 기록된다", async () => {
  const term = await seedTerm("Revert Route Author Probe");
  const user = await loginAsNewUser();

  await revertPost(revertRequest(), ctx(term.slug, "1"));

  const [latest] = await listRevisions(term.id);
  expect(latest!.authorId).toBe(user.id);
  expect(latest!.message).toBe("#1으로 되돌림");
});

test("기대 리비전이 어긋나면 409 revision_conflict다", async () => {
  const term = await seedTerm("Revert Route Conflict Probe");
  await loginAsNewUser();

  const res = await revertPost(revertRequest({ expectedRevision: 1 }), ctx(term.slug, "1"));

  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error.code).toBe("revision_conflict");
  expect(body.error.details.currentRevision).toBe(2);
});

test("없는 리비전 번호는 404다", async () => {
  const term = await seedTerm("Revert Route Missing Revision Probe");
  await loginAsNewUser();

  const res = await revertPost(revertRequest(), ctx(term.slug, "99"));

  expect(res.status).toBe(404);
  await expect(res.json()).resolves.toEqual({
    error: { code: "not_found", message: "리비전 #99을 찾을 수 없습니다." },
  });
});

// Number("")는 0, Number(" 3 ")은 3이다 — 경로 조각을 그대로 Number에 넣으면
// 이런 값들이 조용히 통과한다.
test("숫자가 아닌 리비전 경로 조각은 404다", async () => {
  const term = await seedTerm("Revert Route Bad Segment Probe");
  await loginAsNewUser();

  for (const bad of ["", " 1 ", "1.5", "-1", "0", "abc"]) {
    const res = await revertPost(revertRequest(), ctx(term.slug, bad));
    expect(res.status, `"${bad}"`).toBe(404);
  }
});

test("없는 용어는 404 term_not_found다", async () => {
  await loginAsNewUser();

  const res = await revertPost(revertRequest(), ctx("no-such-term-slug-xyz", "1"));

  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("term_not_found");
});

test("expectedRevision이 숫자가 아니면 400이다", async () => {
  const term = await seedTerm("Revert Route Bad Body Probe");
  await loginAsNewUser();

  const res = await revertPost(revertRequest({ expectedRevision: "2" }), ctx(term.slug, "1"));

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});
