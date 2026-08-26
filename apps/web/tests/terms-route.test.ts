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

const { GET: termsGet, POST: termsPost } = await import("../src/app/api/v1/terms/route.js");
const { GET: termDetailGet, PATCH: termPatch, DELETE: termDelete } = await import(
  "../src/app/api/v1/terms/[idOrSlug]/route.js"
);
const { GET: termRevisionsGet } = await import("../src/app/api/v1/terms/[idOrSlug]/revisions/route.js");

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

async function makeUser(role: "admin" | "editor" = "editor") {
  const [row] = await db
    .insert(users)
    .values({
      email: `terms-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "라우트 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
      role,
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

function patchRequest(body: unknown, token?: string) {
  return new Request("http://x", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(token?: string) {
  return new Request("http://x", {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function getRequest(path: string, token?: string) {
  return new Request(`http://x${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
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

// P7(re-review): `withApiErrors`를 라우트에서 벗겨내도 77개 테스트가 전부 그린이었다.
// 이 라우트에서 예외가 던져지는 경로를 아무도 실행하지 않았기 때문이다. 모킹 대신
// 실제 코드 경로로 진짜 예외를 만든다 — Postgres의 text 타입은 NUL 바이트를 저장할
// 수 없어서(22021) insert가 던진다. zod는 통과시키므로 400이 아니라 500으로 가야 한다.
test("저장 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (P7)", async () => {
  const { token } = await makeKeyRow(["write"]);
  const res = await termsPost(
    postRequest(
      { nameEn: "Route Throw Probe", definitionMd: "nul\u0000byte", domain: [], surfaces: [] },
      token,
    ),
  );

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R44: GET도 requireAuth를 거쳐야 한다. 이 테스트가 없으면 GET에서
// requireAuth 호출을 통째로 지워도 아무 것도 못 잡는다.
test("인증 없이 목록 조회는 401 (R44)", async () => {
  const res = await termsGet(getRequest("/api/v1/terms"));
  expect(res.status).toBe(401);
});

test("인증 없이 상세 조회는 401 (R44)", async () => {
  const res = await termDetailGet(getRequest("/api/v1/terms/anything"), {
    params: Promise.resolve({ idOrSlug: "anything" }),
  });
  expect(res.status).toBe(401);
});

// R41: 알 수 없는 ?type=은 500 internal_error가 아니라 400 validation_failed여야
// 한다. listTerms의 `eq(terms.termType, params.termType as never)`를 되살리면
// (검증 없이 그대로 DB에 넘기면) Postgres가 22P02(잘못된 enum 리터럴)를 던지고
// withApiErrors가 500으로 바꾸는데, 이 값은 재시도해도 절대 성공하지 않는
// 영구적으로 잘못된 입력이라 500은 틀린 신호다.
test("알 수 없는 ?type=은 500이 아니라 400 validation_failed (R41)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest("/api/v1/terms?type=bogus", token));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

test("알 수 없는 ?status=는 500이 아니라 400 validation_failed (R41)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest("/api/v1/terms?status=bogus", token));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

test("유효한 ?type=/?status=는 목록을 정상적으로 반환한다 (R41)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest("/api/v1/terms?type=term&status=draft", token));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(typeof body.total).toBe("number");
});

test("read scope 키로 목록/상세를 조회할 수 있다", async () => {
  const { token } = await makeKeyRow(["write"]);
  const created = await termsPost(
    postRequest({ nameEn: "Route Get Probe", domain: [], surfaces: [] }, token),
  );
  const createdBody = await created.json();
  createdTermIds.push(createdBody.term.id);

  const { token: readToken } = await makeKeyRow(["read"]);

  const detailRes = await termDetailGet(getRequest(`/api/v1/terms/${createdBody.term.slug}`, readToken), {
    params: Promise.resolve({ idOrSlug: createdBody.term.slug as string }),
  });
  expect(detailRes.status).toBe(200);
  const detailBody = await detailRes.json();
  expect(detailBody.term.id).toBe(createdBody.term.id);
  expect(detailBody.term.slug).toBe(createdBody.term.slug);

  const listRes = await termsGet(getRequest(`/api/v1/terms?q=${encodeURIComponent("Route Get Probe")}`, readToken));
  expect(listRes.status).toBe(200);
  const listBody = await listRes.json();
  expect(listBody.items.map((t: { id: string }) => t.id)).toContain(createdBody.term.id);
});

// 존재하지 않는 슬러그는 404 term_not_found여야 한다.
test("존재하지 않는 슬러그로 상세 조회하면 404 term_not_found", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termDetailGet(getRequest("/api/v1/terms/does-not-exist-route-probe", token), {
    params: Promise.resolve({ idOrSlug: "does-not-exist-route-probe" }),
  });
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("term_not_found");
});

// R58(F1): 리뷰가 GET route.ts:37에서 withApiErrors를 벗겨내도 98개 테스트가
// 전부 그린이었다고 지적했다 — GET에서 예외가 던져지는 경로를 아무도 실행하지
// 않았기 때문이다. P7과 동일한 패턴: 모킹 없이, ?q= 값에 NUL 바이트를 실어
// termSurfaces.normLoose와의 eq() 바인드 파라미터로 흘려보내면 Postgres가
// 22021(invalid byte sequence)을 던진다. zod 같은 앞단 검증이 없는 경로이므로
// 400이 아니라 500으로 가야 하고, 본문 없는 500이 아니라 JSON 에러 규약을
// 지켜야 한다.
test("목록 조회 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (R58)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest(`/api/v1/terms?q=${encodeURIComponent("nul\u0000byte")}`, token));

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R58(F1): [idOrSlug]/route.ts:12도 같은 구멍이다. idOrSlug는 URL 인코딩을 거치지
// 않고 ctx.params로 직접 들어올 수 있으므로(라우터가 디코딩해서 넘긴다), NUL
// 바이트를 담은 문자열을 params로 직접 주입한다 — isUuid가 false이므로 slug
// eq() 바인드로 흘러가 Postgres가 22021을 던진다.
test("상세 조회 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (R58)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termDetailGet(getRequest("/api/v1/terms/nul-byte-probe", token), {
    params: Promise.resolve({ idOrSlug: "nul\u0000byte" }),
  });

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R59(F2): Number("1e999")는 Infinity다. 그 값이 .offset()까지 그대로 흘러가면
// Postgres가 예외를 던지고(이전 코드에서는 withApiErrors가 이를 500으로
// 바꿨다) — 이 입력은 재시도해도 절대 성공하지 않는 영구적으로 잘못된 입력이라
// 500이 아니라 400 validation_failed여야 한다(R41과 같은 이유).
test("?page=1e999는 500이 아니라 400 validation_failed (R59)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest("/api/v1/terms?page=1e999", token));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

// R64: `?type=`처럼 파라미터가 존재하지만 값이 빈 문자열인 경우는 "알 수 없는
// 값"(bogus)이 아니라 "지정 안 함"으로 취급해야 한다 — 그렇지 않으면 같은
// querystring 안에서 파라미터마다 규칙이 갈린다(`?q=`/`?domain=`은 이미
// listTerms에서 빈 문자열이 falsy로 걸러져 조용히 무시된다). Task 12/13의
// 필터 바가 선택 안 된 <select>를 `type=`으로 직렬화하면(대부분의 폼 헬퍼의
// 기본 동작) 이 경로를 실제로 탄다.
test("?type=&status=&q=&domain=&page=&pageSize=는 400이 아니라 필터 없는 200을 반환한다 (R64)", async () => {
  const { token } = await makeKeyRow(["write"]);
  const created = await termsPost(
    postRequest({ nameEn: "Route Empty Param Probe", domain: [], surfaces: [] }, token),
  );
  const createdBody = await created.json();
  createdTermIds.push(createdBody.term.id);

  const { token: readToken } = await makeKeyRow(["read"]);
  const res = await termsGet(
    getRequest("/api/v1/terms?type=&status=&q=&domain=&page=&pageSize=", readToken),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(20);
  expect(body.items.map((t: { id: string }) => t.id)).toContain(createdBody.term.id);
});

// R65: 빈 값(`?page=`)과 형식이 잘못된 값(`?page=abc`/`?page=1e999`)은 서로 다른
// 것이다 — 빈 값은 "지정 안 함"(기본값), 형식이 잘못된 값은 "잘못 지정
// 함"(400, 위의 R59 테스트)이다. 이 테스트를 R59 테스트와 별개의 named test로
// 유지해야, 나중에 누가 실수로 둘을 하나의 규칙으로 합쳐도(둘 다 기본값이거나
// 둘 다 400이거나) 최소 하나는 깨진다.
test("?page=/?pageSize=가 빈 문자열이면 400이 아니라 기본값을 사용한다 (R65)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termsGet(getRequest("/api/v1/terms?page=&pageSize=", token));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(20);
});

// ----- Task 10: PATCH / DELETE / revisions -----

async function seedRouteTerm() {
  const { token } = await makeKeyRow(["write"]);
  const res = await termsPost(
    postRequest({ nameEn: `Route Update Probe ${Date.now()}-${Math.random().toString(36).slice(2)}`, domain: [], surfaces: [] }, token),
  );
  const body = await res.json();
  createdTermIds.push(body.term.id);
  return body.term as { id: string; slug: string };
}

test("인증 없이 patch는 401", async () => {
  const term = await seedRouteTerm();
  const res = await termPatch(patchRequest({ nameKo: "x" }), { params: Promise.resolve({ idOrSlug: term.slug }) });
  expect(res.status).toBe(401);
});

test("read scope 키로는 patch가 403", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["read"]);
  const res = await termPatch(patchRequest({ nameKo: "x" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(403);
});

test("존재하지 않는 용어를 patch하면 404 term_not_found", async () => {
  const { token } = await makeKeyRow(["write"]);
  const res = await termPatch(patchRequest({ nameKo: "x" }, token), {
    params: Promise.resolve({ idOrSlug: "route-patch-does-not-exist" }),
  });
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("term_not_found");
});

test("write scope 키로 patch하면 200과 함께 갱신된 term을 반환한다", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["write"]);
  const res = await termPatch(patchRequest({ nameKo: "라우트패치", bodyMd: "본문" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.term.nameKo).toBe("라우트패치");
  expect(body.term.bodyMd).toBe("본문");
});

// R52: 라우트는 updateTerm의 invalid 결과를 400 validation_failed로 변환해야 한다.
test("병합된 표기가 모순되면 patch는 400 validation_failed (R52)", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["read", "write"]);
  const detail = await termDetailGet(getRequest(`/api/v1/terms/${term.slug}`, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  const detailBody = await detail.json();
  const canonicalText = detailBody.term.surfaces[0].text as string;

  const res = await termPatch(
    patchRequest({ surfaces: [{ text: canonicalText, lang: "en", kind: "forbidden" }] }, token),
    { params: Promise.resolve({ idOrSlug: term.slug }) },
  );
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

// R54: updateTerm의 conflict 결과는 409 revision_conflict로 변환되어야 한다.
test("기대 리비전이 어긋나면 patch는 409 revision_conflict (R54)", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["write"]);
  const res = await termPatch(patchRequest({ nameKo: "x", expectedRevision: 999 }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error.code).toBe("revision_conflict");
  expect(body.error.details.currentRevision).toBe(1);
});

test("인증 없이 delete는 401", async () => {
  const term = await seedRouteTerm();
  const res = await termDelete(deleteRequest(), { params: Promise.resolve({ idOrSlug: term.slug }) });
  expect(res.status).toBe(401);
});

// 역할은 admin | editor. DELETE /terms/{id}는 admin 전용 — editor 사용자는 거부되어야 한다.
test("editor 사용자는 delete가 403", async () => {
  const term = await seedRouteTerm();
  const user = await makeUser("editor");
  await loginAs(user);
  const res = await termDelete(deleteRequest(), { params: Promise.resolve({ idOrSlug: term.slug }) });
  expect(res.status).toBe(403);
});

// API 키에는 역할 개념이 없다 — write scope가 있어도 delete는 거부되어야 한다.
test("write scope API 키는 delete가 403", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["write"]);
  const res = await termDelete(deleteRequest(token), { params: Promise.resolve({ idOrSlug: term.slug }) });
  expect(res.status).toBe(403);
});

test("admin 사용자는 delete로 용어를 지울 수 있고, 지운 뒤 조회하면 404다", async () => {
  const term = await seedRouteTerm();
  const admin = await makeUser("admin");
  await loginAs(admin);

  const res = await termDelete(deleteRequest(), { params: Promise.resolve({ idOrSlug: term.slug }) });
  expect(res.status).toBe(204);

  currentCookieValue = undefined;
  const { token } = await makeKeyRow(["read"]);
  const after = await termDetailGet(getRequest(`/api/v1/terms/${term.slug}`, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(after.status).toBe(404);
});

test("존재하지 않는 용어를 delete하면 404 term_not_found", async () => {
  const admin = await makeUser("admin");
  await loginAs(admin);
  const res = await termDelete(deleteRequest(), {
    params: Promise.resolve({ idOrSlug: "route-delete-does-not-exist" }),
  });
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("term_not_found");
});

test("인증 없이 리비전 조회는 401", async () => {
  const term = await seedRouteTerm();
  const res = await termRevisionsGet(getRequest(`/api/v1/terms/${term.slug}/revisions`), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(401);
});

test("리비전 목록은 최신순이며 createdAt이 ISO 문자열로 직렬화된다", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["write"]);
  await termPatch(patchRequest({ nameKo: "리비전테스트" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });

  const { token: readToken } = await makeKeyRow(["read"]);
  const res = await termRevisionsGet(getRequest(`/api/v1/terms/${term.slug}/revisions`, readToken), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.revisions.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([2, 1]);
  expect(typeof body.revisions[0].createdAt).toBe("string");
  expect(Number.isNaN(Date.parse(body.revisions[0].createdAt))).toBe(false);
});

test("존재하지 않는 용어의 리비전 조회는 404 term_not_found", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termRevisionsGet(getRequest("/api/v1/terms/route-revisions-does-not-exist/revisions", token), {
    params: Promise.resolve({ idOrSlug: "route-revisions-does-not-exist" }),
  });
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("term_not_found");
});

// ----- Fix round 1: R69/R70(a)/R72 -----

// R69(F1): P7/R58와 같은 구멍이 세 번째로 반복됐다 — PATCH/DELETE/revisions GET
// 어디에서도 withApiErrors를 벗겨낸 채 실행되는 경로가 없었다. 모킹 없이 실제
// Postgres 22021(text에 NUL 저장 불가)로 예외를 만든다.
test("patch 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (R69)", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["write"]);
  const res = await termPatch(patchRequest({ bodyMd: "nul byte" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R69(F1): DELETE는 admin 세션으로 role 검사를 통과한 뒤, getTermByIdOrSlug가
// idOrSlug를 slug eq() 바인드로 흘려보내는 지점에서 예외가 난다.
test("delete 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (R69)", async () => {
  const admin = await makeUser("admin");
  await loginAs(admin);
  const res = await termDelete(deleteRequest(), {
    params: Promise.resolve({ idOrSlug: "nul byte" }),
  });

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R69(F1): revisions GET도 getTermByIdOrSlug를 거치므로 같은 지점에서 예외가 난다.
test("리비전 조회 중 예외가 나도 본문 없는 500이 아니라 JSON 에러 규약을 지킨다 (R69)", async () => {
  const { token } = await makeKeyRow(["read"]);
  const res = await termRevisionsGet(getRequest("/api/v1/terms/nul-byte-probe/revisions", token), {
    params: Promise.resolve({ idOrSlug: "nul byte" }),
  });

  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "internal_error", message: "서버 오류가 발생했습니다." },
  });
});

// R70(F2)a: R51의 "surfaces 없으면 명시 표기 유지" 규칙은 라이브러리 테스트만
// 있고 라우트 테스트가 없었다 — 라우트가 `surfaces: patchInput.surfaces ?? []`로
// undefined를 []로 바꿔치기해도(P18) 라이브러리 테스트는 못 잡는다. 실제 HTTP
// 요청 두 번(표기 추가 -> surfaces 없는 patch)으로 라우트를 종단까지 통과시킨다.
test("surfaces 없이 patch하면 라우트를 통해서도 기존 명시 표기가 유지된다 (R70a)", async () => {
  const term = await seedRouteTerm();
  const { token } = await makeKeyRow(["read", "write"]);

  const withAlias = await termPatch(
    patchRequest({ surfaces: [{ text: "Route Alias Probe", lang: "en", kind: "alias" }] }, token),
    { params: Promise.resolve({ idOrSlug: term.slug }) },
  );
  expect(withAlias.status).toBe(200);

  const statusOnly = await termPatch(patchRequest({ status: "approved" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(statusOnly.status).toBe(200);

  const detail = await termDetailGet(getRequest(`/api/v1/terms/${term.slug}`, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  const detailBody = await detail.json();
  const texts = detailBody.term.surfaces.map((s: { text: string }) => s.text);
  expect(texts).toContain("Route Alias Probe");
});

// R72(F4): PATCH의 작성자 배선이 라우트 테스트를 못 받았다 — POST에는 R47이
// 정확히 이 두 테스트를 갖고 있는데 PATCH는 코드만 받고 테스트를 못 받았다.
// authorId가 null이면 R55 가드 때문에 updatedBy까지 조용히 건너뛰므로 둘 다
// 같이 단언한다.
test("API 키로 patch하면 리비전에 author_key_id가 기록되고 updatedBy는 지워지지 않는다 (R72)", async () => {
  const term = await seedRouteTerm();

  const user = await makeUser();
  await loginAs(user);
  const baseline = await termPatch(patchRequest({ nameKo: "기준값" }), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(baseline.status).toBe(200);
  currentCookieValue = undefined;

  const { token, row } = await makeKeyRow(["write"]);
  const res = await termPatch(patchRequest({ bodyMd: "API 키 patch" }, token), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(200);

  const revs = await db
    .select()
    .from(termRevisions)
    .where(eq(termRevisions.termId, term.id))
    .orderBy(termRevisions.revisionNumber);
  const latest = revs[revs.length - 1]!;
  expect(latest.authorKeyId).toBe(row.id);
  expect(latest.authorId).toBeNull();

  const [row_] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row_!.updatedBy).toBe(user.id);
});

test("로그인한 사용자로 patch하면 리비전에 author_id가 기록되고 updatedBy가 갱신된다 (R72)", async () => {
  const term = await seedRouteTerm();
  const user = await makeUser();
  await loginAs(user);

  const res = await termPatch(patchRequest({ nameKo: "사용자패치" }), {
    params: Promise.resolve({ idOrSlug: term.slug }),
  });
  expect(res.status).toBe(200);

  const revs = await db
    .select()
    .from(termRevisions)
    .where(eq(termRevisions.termId, term.id))
    .orderBy(termRevisions.revisionNumber);
  const latest = revs[revs.length - 1]!;
  expect(latest.authorId).toBe(user.id);
  expect(latest.authorKeyId).toBeNull();

  const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row!.updatedBy).toBe(user.id);
});
