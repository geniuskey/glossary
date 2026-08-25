import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms, termRevisions, users } from "@grossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

// C2(리뷰): 어떤 테스트도 POST /api/v1/terms의 인증을 직접 두들기지 않았다.
// requireAuth(request, "write")를 통째로 지워도 57개 테스트가 그린으로 남는
// 회귀였다. api-key.test.ts와 동일한 방식으로 next/headers를 모킹한다.
let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { POST: termsPost } = await import("../src/app/api/v1/terms/route.js");

const db = createDb(process.env.DATABASE_URL!);
const createdTermIds: string[] = [];
const createdKeyIds: string[] = [];
const createdUserIds: string[] = [];

async function makeKeyRow(scopes: string[]) {
  const { token, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name: "라우트 테스트 키", prefix, keyHash: hash, scopes })
    .returning();
  createdKeyIds.push(row!.id);
  return { token, row: row! };
}

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({
      email: `terms-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "라우트 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  createdUserIds.push(row!.id);
  return row!;
}

async function loginAs(user: { id: string }) {
  const { token } = await createSession(user.id);
  currentCookieValue = token;
}

function postRequest(body: unknown, token?: string) {
  return new Request("http://x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  currentCookieValue = undefined;
});

afterAll(async () => {
  for (const id of createdTermIds) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdKeyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

test("인증 헤더도 세션도 없으면 용어 생성은 401 (C2)", async () => {
  const res = await termsPost(postRequest({ nameEn: "Route Auth Probe A", domain: [], surfaces: [] }));
  expect(res.status).toBe(401);
});

test("read scope 키로는 용어 생성이 403 (C2)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsPost(
    postRequest({ nameEn: "Route Auth Probe B", domain: [], surfaces: [] }, token),
  );
  expect(res.status).toBe(403);
});

test("write scope 키로는 용어 생성이 201 (C2)", async () => {
  const { token } = await makeKeyRow(["write"]);
  const res = await termsPost(
    postRequest({ nameEn: "Route Auth Probe C", domain: [], surfaces: [] }, token),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  createdTermIds.push(body.term.id);
});

// R47: API 키로 인증된 요청은 authorId가 항상 null이라, authorKeyId가 없으면
// 누가 썼는지 영원히 알 수 없다(나중에 채워 넣을 방법이 없다).
test("API 키로 생성하면 리비전에 author_key_id가 기록되고 author_id는 null이다 (R47)", async () => {
  const { token, row } = await makeKeyRow(["write"]);
  const res = await termsPost(
    postRequest({ nameEn: "Route Author Key Probe", domain: [], surfaces: [] }, token),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  createdTermIds.push(body.term.id);

  const [rev] = await db.select().from(termRevisions).where(eq(termRevisions.termId, body.term.id));
  expect(rev!.authorKeyId).toBe(row.id);
  expect(rev!.authorId).toBeNull();
});

test("로그인한 사용자로 생성하면 리비전의 author_key_id는 null이다 (R47)", async () => {
  const user = await makeUser();
  await loginAs(user);

  const res = await termsPost(
    postRequest({ nameEn: "Route Author User Probe", domain: [], surfaces: [] }),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  createdTermIds.push(body.term.id);

  const [rev] = await db.select().from(termRevisions).where(eq(termRevisions.termId, body.term.id));
  expect(rev!.authorId).toBe(user.id);
  expect(rev!.authorKeyId).toBeNull();
});
