import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, users } from "@grossary/db";
import { generateApiKey, hashApiKey, parseApiKey } from "../src/lib/auth/api-key.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

// requireAuth와 /api/v1/keys* 라우트는 로그인 여부를 getCurrentUser로 판단하고,
// getCurrentUser는 next/headers의 cookies()가 실제 요청 컨텍스트에서만 동작한다는
// 전제로 만들어졌다. current-user.test.ts와 동일한 방식으로 모킹한다.
let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { requireAuth, isResponse } = await import("../src/lib/auth/require.js");
const { GET: keysGet, POST: keysPost } = await import("../src/app/api/v1/keys/route.js");
const { DELETE: keyDelete } = await import("../src/app/api/v1/keys/[id]/route.js");

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];
const createdKeyIds: string[] = [];

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({
      email: `api-key-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "API 키 테스트",
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

async function makeKeyRow(overrides: { scopes?: string[]; revokedAt?: Date | null; expiresAt?: Date | null } = {}) {
  const { token, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: "테스트 키",
      prefix,
      keyHash: hash,
      scopes: overrides.scopes ?? ["read"],
      revokedAt: overrides.revokedAt ?? null,
      expiresAt: overrides.expiresAt ?? null,
    })
    .returning();
  createdKeyIds.push(row!.id);
  return { token, row: row! };
}

afterEach(() => {
  currentCookieValue = undefined;
});

afterAll(async () => {
  for (const id of createdKeyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

test("발급된 토큰이 규약 형식을 따른다", () => {
  const { token, prefix } = generateApiKey();
  expect(token.startsWith(`glk_${prefix}_`)).toBe(true);
  expect(prefix).toHaveLength(8);
});

test("토큰 해시가 재현 가능하다", () => {
  const { token, hash } = generateApiKey();
  expect(hashApiKey(token)).toBe(hash);
});

test("매 발급마다 서로 다른 토큰이 나온다", () => {
  expect(generateApiKey().token).not.toBe(generateApiKey().token);
});

// R35(b): 브리프 원안의 token.split("_")는 secret에 "_"가 섞이면(base64url이라
// 흔히 일어난다) 4조각 이상으로 쪼개져 유효한 토큰을 계속 거부한다. 무작위로
// 생성된 토큰으로만 검증하면 secret이 우연히 "_"를 포함하지 않는 절반의 실행에서
// 이 회귀를 그냥 통과시켜 버린다(실측: 전체 스위트 6회 중 3회 통과). 그래서 secret에
// "_"와 "-"를 일부러 박아 넣은 고정 토큰으로, 매 실행 100% 같은 결과가 나오게 한다.
test("parseApiKey는 secret에 _와 -가 섞여 있어도 고정폭 prefix에 앵커링해 정확히 분리한다", () => {
  expect(parseApiKey("glk_deadbeef_abc_def-ghi")).toEqual({ prefix: "deadbeef" });
  expect(parseApiKey("glk_00000000_a-b_c_d-e_f_g")).toEqual({ prefix: "00000000" });
});

test("parseApiKey는 형식이 틀린 토큰을 거부한다", () => {
  expect(parseApiKey("not-a-token")).toBeNull();
  expect(parseApiKey("glk_short_secret")).toBeNull();
  expect(parseApiKey("glk_deadbeef_")).toBeNull();
});

test("generateApiKey가 만든 토큰은 parseApiKey로 자기 자신의 prefix를 되돌려준다", () => {
  const { token, prefix } = generateApiKey();
  expect(parseApiKey(token)).toEqual({ prefix });
});

test("Authorization 헤더도 세션 쿠키도 없으면 requireAuth가 401을 반환한다", async () => {
  const res = await requireAuth(new Request("http://x"), "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});

test("형식이 잘못된 Bearer 토큰은 401", async () => {
  const req = new Request("http://x", { headers: { authorization: "Bearer not-a-real-token" } });
  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});

test("유효한 키와 scope로 인증되고 lastUsedAt이 갱신된다", async () => {
  const { token, row } = await makeKeyRow({ scopes: ["read", "validate"] });
  const req = new Request("http://x", { headers: { authorization: `Bearer ${token}` } });

  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(false);
  if (!isResponse(res)) expect(res).toEqual({ kind: "key", keyId: row.id });

  const [updated] = await db.select().from(apiKeys).where(eq(apiKeys.id, row.id));
  expect(updated!.lastUsedAt).not.toBeNull();
});

// R35(a): prefix는 비밀이 아니다 — UI 키 목록과 GET /api/v1/keys 응답에 그대로
// 노출된다. 그래서 인증은 실제로 secret의 해시 일치에 의존해야 한다. 여기서
// hashesMatch를 `return true`로 바꾸면(=prefix만 맞으면 통과) 이 테스트가 유일하게
// 잡아낸다 — prefix는 DB의 실제 행과 맞추고 secret만 다르게 만든 토큰을 보낸다.
test("prefix는 맞지만 secret이 틀린 토큰은 401", async () => {
  const { row } = await makeKeyRow();
  const wrongToken = `glk_${row.prefix}_${"x".repeat(43)}`;
  const req = new Request("http://x", { headers: { authorization: `Bearer ${wrongToken}` } });

  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});

// R36: RFC 7235에 따라 인증 스킴(Bearer)은 대소문자를 구분하지 않는다.
// startsWith("Bearer ")로 매칭하면 "bearer <key>"가 세션 경로로 흘러 들어가
// 틀리고 오해의 소지가 있는 "로그인이 필요합니다"(401)를 반환한다.
test("Authorization 스킴은 대소문자를 구분하지 않는다", async () => {
  const { token, row } = await makeKeyRow();

  for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
    const req = new Request("http://x", { headers: { authorization: `${scheme} ${token}` } });
    const res = await requireAuth(req, "read");
    expect(isResponse(res), scheme).toBe(false);
    if (!isResponse(res)) expect(res).toEqual({ kind: "key", keyId: row.id });
  }
});

test("scope가 없는 키는 403", async () => {
  const { token } = await makeKeyRow({ scopes: ["read"] });
  const req = new Request("http://x", { headers: { authorization: `Bearer ${token}` } });

  const res = await requireAuth(req, "write");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(403);
});

test("만료된 키는 401", async () => {
  const { token } = await makeKeyRow({ expiresAt: new Date(Date.now() - 1000) });
  const req = new Request("http://x", { headers: { authorization: `Bearer ${token}` } });

  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});

// R26: 폐기된 키가 requireAuth에서 401이 된다는 것을 DB에 실제 행을 넣어 증명한다.
test("폐기된 키(revokedAt이 실제로 찍힌 DB 행)는 requireAuth에서 401", async () => {
  const { token } = await makeKeyRow({ revokedAt: new Date() });
  const req = new Request("http://x", { headers: { authorization: `Bearer ${token}` } });

  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});

test("세션 쿠키가 유효하면 user kind로 인증된다", async () => {
  const user = await makeUser();
  await loginAs(user);

  const res = await requireAuth(new Request("http://x"), "read");
  expect(isResponse(res)).toBe(false);
  if (!isResponse(res)) expect(res.kind).toBe("user");
});

test("로그인하지 않으면 /api/v1/keys 목록 조회와 발급 모두 401", async () => {
  const getRes = await keysGet();
  expect(getRes.status).toBe(401);

  const postRes = await keysPost(
    new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  expect(postRes.status).toBe(401);
});

test("로그인하면 키를 발급하고 목록에서 조회되며, 평문 토큰은 발급 응답에만 담긴다", async () => {
  const user = await makeUser();
  await loginAs(user);

  const postRes = await keysPost(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ai-lint", scopes: ["read", "validate"] }),
    }),
  );
  expect(postRes.status).toBe(201);
  const created = await postRes.json();
  expect(created.token).toMatch(/^glk_/);
  createdKeyIds.push(created.key.id);

  const getRes = await keysGet();
  const list = (await getRes.json()).keys as Array<{ id: string }>;
  expect(list.some((k) => k.id === created.key.id)).toBe(true);
  expect(JSON.stringify(list)).not.toContain(created.token);
});

test("로그인하지 않으면 키 폐기도 401", async () => {
  const { row } = await makeKeyRow();
  const res = await keyDelete(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: row.id }),
  });
  expect(res.status).toBe(401);
});

test("존재하지 않는 키를 폐기하면 404", async () => {
  const user = await makeUser();
  await loginAs(user);

  const res = await keyDelete(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
  });
  expect(res.status).toBe(404);
});

// R38: 형식이 잘못된 id는 DB 쿼리까지 가지 않고 requireUuid가 먼저 404로 막는다.
// 이 가드가 없으면 Postgres가 invalid input syntax for type uuid를 던지고
// withApiErrors가 이를 500 internal_error로 바꾼다 — 응답 자체는 안전하지만(유출
// 없음), 영구적으로 실패할 요청에 재시도해도 되는 것처럼 5xx로 답하게 된다.
test("형식이 잘못된 id로 키를 폐기하면 404(DB까지 가지 않는다)", async () => {
  const user = await makeUser();
  await loginAs(user);

  const res = await keyDelete(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: "not-a-uuid" }),
  });
  expect(res.status).toBe(404);
  await expect(res.json()).resolves.toEqual({
    error: { code: "not_found", message: "API 키를 찾을 수 없습니다." },
  });
});

test("키를 폐기하면 revokedAt이 찍히고, 이미 폐기된 키를 다시 폐기해도 성공한다(멱등)", async () => {
  const user = await makeUser();
  await loginAs(user);
  const { row } = await makeKeyRow();

  const res1 = await keyDelete(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: row.id }),
  });
  expect(res1.status).toBe(200);

  const [afterFirst] = await db.select().from(apiKeys).where(eq(apiKeys.id, row.id));
  expect(afterFirst!.revokedAt).not.toBeNull();

  const res2 = await keyDelete(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: row.id }),
  });
  expect(res2.status).toBe(200);
});

test("폐기 라우트로 폐기한 키는 requireAuth에서 401이 된다", async () => {
  const user = await makeUser();
  await loginAs(user);
  const { token: apiToken, row } = await makeKeyRow();

  await keyDelete(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: row.id }) });
  currentCookieValue = undefined; // 세션 로그인 상태를 지우고 API 키 경로만 확인한다

  const req = new Request("http://x", { headers: { authorization: `Bearer ${apiToken}` } });
  const res = await requireAuth(req, "read");
  expect(isResponse(res)).toBe(true);
  if (isResponse(res)) expect(res.status).toBe(401);
});
