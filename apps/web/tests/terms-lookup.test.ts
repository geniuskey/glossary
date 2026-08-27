import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms } from "@grossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm } from "../src/lib/terms/create.js";
import { getDb } from "../src/lib/db.js";
import { lookupTerms } from "../src/lib/terms/lookup.js";

// R83/인증 테스트: 세션 쿠키 경로(getCurrentUser)는 next/headers의 cookies()를
// 쓴다. 이 파일의 요청은 실제 Next 요청 컨텍스트 밖에서 만들어지므로 모킹 없이
// 부르면 "cookies() was called outside a request scope"가 던져져 withApiErrors가
// 그걸 500으로 바꿔버린다 — 이러면 "인증 없이 호출하면 401"이라는 의도와 다른
// 경로를 테스트하게 된다. terms-route.test.ts와 같은 방식으로 모킹한다.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE ? undefined : undefined),
  }),
}));

const { POST: lookupPost } = await import("../src/app/api/v1/terms/lookup/route.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
const createdKeyIds: string[] = [];

let ae: Awaited<ReturnType<typeof createTerm>>;
let goodTerm: Awaited<ReturnType<typeof createTerm>>;
let forbiddenTerm: Awaited<ReturnType<typeof createTerm>>;
let simTerm: Awaited<ReturnType<typeof createTerm>>;

async function makeReadKey(): Promise<string> {
  const { token, prefix, hash } = generateApiKey();
  const [key] = await db
    .insert(apiKeys)
    .values({ name: "lookup 테스트 키", prefix, keyHash: hash, scopes: ["read"] })
    .returning();
  createdKeyIds.push(key!.id);
  return token;
}

function lookupRequest(texts: unknown, token?: string): Request {
  return new Request("http://x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ texts }),
  });
}

beforeAll(async () => {
  ae = await createTerm(
    {
      termType: "abbreviation", nameEn: "AE", fullNameEn: "Auto Exposure", nameKo: "자동노출",
      domain: ["ISP"], status: "approved", surfaces: [],
    },
    null,
  );
  ids.push(ae.term.id);

  // R85: 같은 표기가 서로 다른 두 용어에 각각 canonical/forbidden으로 등록된
  // 상황을 재현한다 — 한 용어 안에서 승인군+비승인군을 같은 키로 섞는 건 R45가
  // 막지만, 서로 다른 용어(동음이의)가 같은 표기를 다른 kind로 등록하는 것까지는
  // 막지 않는다. lookupTerms는 이 표기를 조회했을 때 forbidden을 놓치면 안 된다.
  goodTerm = await createTerm(
    { termType: "term", nameEn: "ProbeMatchKind", domain: ["QA"], status: "approved", surfaces: [] },
    null,
  );
  ids.push(goodTerm.term.id);
  forbiddenTerm = await createTerm(
    {
      termType: "term", nameEn: "ProbeMatchKind Retired", domain: ["QA"], status: "forbidden",
      surfaces: [{ text: "ProbeMatchKind", lang: "en", kind: "forbidden" }],
    },
    null,
  );
  ids.push(forbiddenTerm.term.id);

  // R89/R88: 한 용어가 서로 다른 두 표기(둘 다 질의어와 trigram 유사)를 가질 때
  // similar가 슬러그 기준으로 한 번만 나오는지, 점수의 실제 런타임 타입이
  // 무엇인지 확인하기 위한 fixture.
  simTerm = await createTerm(
    {
      termType: "term", nameEn: "SimilarityProbe", domain: ["QA"], status: "approved",
      surfaces: [{ text: "SimilarityProbeAlt", lang: "en", kind: "alias" }],
    },
    null,
  );
  ids.push(simTerm.term.id);
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdKeyIds) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

test("등록된 표기를 찾는다", async () => {
  const [result] = await lookupTerms(["AE"]);
  expect(result!.found).toBe(true);
  expect(result!.matchKind).toBe("abbreviation");
  expect(result!.terms[0]!.nameEn).toBe("AE");
});

test("표기 변형도 같은 용어로 해석한다", async () => {
  const [variant] = await lookupTerms(["AutoExposure"]);
  expect(variant!.found).toBe(true);
  expect(variant!.terms[0]!.id).toBe(ae.term.id);
});

test("미등록 표기는 found=false로 반환한다", async () => {
  const [missing] = await lookupTerms(["Nonexistent Widget Zzq"]);
  expect(missing!.found).toBe(false);
  expect(missing!.terms).toEqual([]);
});

test("요청 순서와 개수를 그대로 보존한다", async () => {
  const results = await lookupTerms(["AE", "Nonexistent Widget Zzq", "자동노출"]);
  expect(results.map((r) => r.text)).toEqual(["AE", "Nonexistent Widget Zzq", "자동노출"]);
});

test("중복 입력도 각각 결과를 돌려준다", async () => {
  const results = await lookupTerms(["AE", "AE"]);
  expect(results).toHaveLength(2);
  expect(results.every((r) => r.found)).toBe(true);
});

// R85: 우선순위 표가 없으면(또는 행 순서에 의존하면) alias가 forbidden보다
// 먼저 보고될 수 있다 — 이 표기는 실제로는 조치가 필요한(forbidden) 표기인데
// 린터가 놓친다.
test("R85: 같은 표기가 alias이자 forbidden이면 matchKind는 forbidden이다", async () => {
  const [result] = await lookupTerms(["ProbeMatchKind"]);
  expect(result!.found).toBe(true);
  expect(result!.matchKind).toBe("forbidden");
  const returnedIds = result!.terms.map((t) => t.id).sort();
  expect(returnedIds).toEqual([goodTerm.term.id, forbiddenTerm.term.id].sort());
});

// R86: slugify("Lookup") === "lookup"이고, Next는 정적 세그먼트(terms/lookup)를
// 동적 세그먼트(terms/[idOrSlug])보다 먼저 매칭한다. uniqueSlug가 예약어를
// 피하지 않으면 이 용어는 GET /api/v1/terms/lookup으로 영원히 조회 불가능해진다.
test("R86: 이름이 Lookup인 용어는 슬러그가 lookup이 되지 않는다", async () => {
  const reserved = await createTerm(
    { termType: "term", nameEn: "Lookup", domain: ["QA"], status: "approved", surfaces: [] },
    null,
  );
  ids.push(reserved.term.id);
  expect(reserved.term.slug).not.toBe("lookup");
});

// R89/R88: 같은 용어의 두 표기가 모두 질의어와 유사할 때 similar에 그 용어의
// 슬러그가 한 번만 나오는지, score의 실측 typeof가 무엇인지 확인한다.
test("R89/R88: similar는 슬러그 기준으로 중복 제거되고 score는 실제로 number다", async () => {
  const [result] = await lookupTerms(["SimilarityProbez"]);
  expect(result!.found).toBe(false);
  const matchesForSimTerm = result!.similar.filter((s) => s.slug === simTerm.term.slug);
  expect(matchesForSimTerm).toHaveLength(1);
  expect(result!.similar.length).toBeGreaterThan(0);
  for (const s of result!.similar) {
    // R88: sql<number>는 검증되지 않은 타입 단언이다 — 드라이버가 실제로 무엇을
    // 주는지 실측한다. 실측 결과: postgres-js는 pg_trgm의 similarity() (real/
    // float4)를 JS number로 파싱해서 준다 — typeof는 "number"다.
    expect(typeof s.score).toBe("number");
  }
});

// R84: 미등록 키 개수와 무관하게 유사어 조회가 한 번의 db.execute 왕복으로
// 끝나는지 실측한다. lookupTerms 내부에서 매치된 표기 조회는 db.select()
// 빌더를 쓰고(top-level db.execute를 거치지 않는다), 유사어 조회만 raw SQL로
// db.execute를 직접 호출하므로, 이 스파이는 유사어 fallback 쿼리 횟수를
// 정확히 센다.
test("R84: 미등록 키가 여럿이어도 유사어 조회는 db.execute를 정확히 한 번만 호출한다", async () => {
  const spy = vi.spyOn(getDb(), "execute");
  try {
    const manyMissingKeys = Array.from({ length: 12 }, (_, i) => `NonexistentBatchProbe${i}`);
    await lookupTerms(manyMissingKeys);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

// R83: withApiErrors 커버리지. Postgres의 text 타입은 NUL 바이트를 담을 수
// 없다(SQLSTATE 22021) — normalizeSurface는 NUL을 걷어내지 않으므로, 이 요청은
// lookupTerms 내부의 실제 쿼리에서 진짜 PostgresError를 던진다. 목을 쓰지 않고
// 실제 예외 경로로 라우트의 JSON 에러 규약을 확인한다.
test("R83: NUL 바이트가 유발하는 실제 Postgres 예외도 JSON 에러 규약을 지킨다", async () => {
  const token = await makeReadKey();
  const res = await lookupPost(lookupRequest(["nul\0byte"], token));
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = await res.json();
  expect(body).toEqual({ error: { code: "internal_error", message: "서버 오류가 발생했습니다." } });
});

test("인증 없이 호출하면 401을 반환한다", async () => {
  const res = await lookupPost(lookupRequest(["AE"]));
  expect(res.status).toBe(401);
});

test("유효한 API 키로 호출하면 결과 배열을 반환한다", async () => {
  const token = await makeReadKey();
  const res = await lookupPost(lookupRequest(["AE", "Nonexistent Widget Zzq"], token));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.results).toHaveLength(2);
  expect(body.results[0].found).toBe(true);
});

// R87: 공백뿐인 원소는 zod가 걸러야 한다(R46과 같은 함정).
test("R87: 공백뿐인 texts 원소는 400 validation_failed로 거부한다", async () => {
  const token = await makeReadKey();
  const res = await lookupPost(lookupRequest(["   "], token));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});
