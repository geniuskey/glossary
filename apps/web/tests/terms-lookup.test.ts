import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { apiKeys, createDb, terms, termSurfaces } from "@grossary/db";
import { generateApiKey } from "../src/lib/auth/api-key.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";
import { createTerm, RESERVED_SLUGS } from "../src/lib/terms/create.js";
import { getDb } from "../src/lib/db.js";
import { lookupTerms, MATCH_KIND_PRIORITY, pickMatchKind } from "../src/lib/terms/lookup.js";
import { legacyRedirects } from "../next.config.js";

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
let draftTerm: Awaited<ReturnType<typeof createTerm>>;

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
      domain: ["ISP"], status: "active", surfaces: [],
    },
    null,
  );
  ids.push(ae.term.id);

  // R85: 같은 표기가 서로 다른 두 용어에 각각 canonical/forbidden으로 등록된
  // 상황을 재현한다 — 한 용어 안에서 승인군+비승인군을 같은 키로 섞는 건 R45가
  // 막지만, 서로 다른 용어(동음이의)가 같은 표기를 다른 kind로 등록하는 것까지는
  // 막지 않는다. lookupTerms는 이 표기를 조회했을 때 forbidden을 놓치면 안 된다.
  goodTerm = await createTerm(
    { termType: "term", nameEn: "ProbeMatchKind", domain: ["QA"], status: "active", surfaces: [] },
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
      termType: "term", nameEn: "SimilarityProbe", domain: ["QA"], status: "active",
      surfaces: [{ text: "SimilarityProbeAlt", lang: "en", kind: "alias" }],
    },
    null,
  );
  ids.push(simTerm.term.id);

  draftTerm = await createTerm(
    {
      termType: "term", nameEn: "HiddenDraftLookupProbe", domain: ["QA"], status: "draft",
      definitionMd: "공개 전 조회 제외 확인용.", surfaces: [],
    },
    null,
  );
  ids.push(draftTerm.term.id);
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
  // 이미 정확히 매치된 표기에는 굳이 유사어 후보를 얹지 않는다 — 매치가
  // 있는데도 similar를 채우면(회귀: matchedTerms.length > 0 조건이 빠지면)
  // 응답이 쓸데없이 커지고, "정확히 찾았다"는 신호를 흐린다.
  expect(result!.similar).toEqual([]);
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

test("draft는 정확 조회와 유사어 후보에서 모두 제외된다", async () => {
  const [exact] = await lookupTerms(["HiddenDraftLookupProbe"]);
  expect(exact).toMatchObject({ found: false, terms: [] });

  const [similar] = await lookupTerms(["HiddenDraftLookupProbez"]);
  expect(similar!.similar.map((item) => item.slug)).not.toContain(draftTerm.term.slug);
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

// R85/R100: 우선순위 표가 없으면(또는 행 순서에 의존하면) canonical이
// forbidden보다 먼저 보고될 수 있다 — 이 표기는 실제로는 조치가 필요한
// (forbidden) 표기인데 린터가 놓친다. (이름과 fixture가 어긋나 있던 문제를
// 고쳤다: goodTerm은 alias가 아니라 canonical이다 — 테스트 이름을 fixture에
// 맞췄다.)
test("R85: 같은 표기가 canonical이자 forbidden이면 matchKind는 forbidden이다", async () => {
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
    { termType: "term", nameEn: "Lookup", domain: ["QA"], status: "active", surfaces: [] },
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

// R99: z.string().trim()은 zod 3.25에서 검증이 아니라 변환이다 — parsed.data
// 자체가 trim된 문자열로 바뀐다. lookupTerms는 그 값을 그대로 응답의 text에
// echo하므로, trim()을 쓰면 응답의 text가 요청 원문과 달라져 R87을 어긴다.
// 매치 자체는 여전히 성공해야 한다(normLoose가 공백을 걷어내므로 "  AE  "와
// "AE"는 같은 키로 정규화된다) — 원문 echo와 매치 성공은 별개의 계약이다.
test("R99: 응답의 text는 앞뒤 공백을 포함한 요청 원문 그대로다", async () => {
  const token = await makeReadKey();
  const res = await lookupPost(lookupRequest(["  AE  ", "\tAE\n"], token));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.results.map((r: { text: string }) => r.text)).toEqual(["  AE  ", "\tAE\n"]);
  expect(body.results.every((r: { found: boolean }) => r.found)).toBe(true);
});

// R100: MATCH_KIND_PRIORITY는 제품 규칙이다(R85) — 표의 인접 쌍 5개를 전부
// 단위 테스트로 고정한다. M1(discouraged<->canonical), M2(abbreviation<->alias),
// M3(full_name<->alias) 세 교란 모두 아래 쌍들 중 최소 하나를 뒤집는다.
test("R100: MATCH_KIND_PRIORITY 인접 쌍 5개를 모두 고정한다", () => {
  expect(pickMatchKind(["forbidden", "discouraged"])).toBe("forbidden");
  expect(pickMatchKind(["discouraged", "forbidden"])).toBe("forbidden");
  expect(pickMatchKind(["discouraged", "canonical"])).toBe("discouraged");
  expect(pickMatchKind(["canonical", "discouraged"])).toBe("discouraged");
  expect(pickMatchKind(["canonical", "abbreviation"])).toBe("canonical");
  expect(pickMatchKind(["abbreviation", "canonical"])).toBe("canonical");
  expect(pickMatchKind(["abbreviation", "full_name"])).toBe("abbreviation");
  expect(pickMatchKind(["full_name", "abbreviation"])).toBe("abbreviation");
  expect(pickMatchKind(["full_name", "alias"])).toBe("full_name");
  expect(pickMatchKind(["alias", "full_name"])).toBe("full_name");
});

test("R100: 6종을 섞어도 forbidden이 이긴다", () => {
  const allKinds = Object.keys(MATCH_KIND_PRIORITY) as Array<keyof typeof MATCH_KIND_PRIORITY>;
  expect(allKinds).toHaveLength(6);
  // MATCH_KIND_PRIORITY 자신의 선언 순서를 뒤집은 것과, 완전히 임의로 섞은 것
  // 둘 다 forbidden으로 수렴해야 한다(reduce의 순회 방향에 우연히 기대지 않음).
  expect(pickMatchKind([...allKinds].reverse())).toBe("forbidden");
  expect(pickMatchKind(["alias", "canonical", "forbidden", "full_name", "discouraged", "abbreviation"])).toBe(
    "forbidden",
  );
});

// R103: term_surfaces_unique는 (term_id, norm_loose, kind)라 한 용어가 같은
// normLoose를 서로 다른 kind로 두 번 가질 수 있다(예: 약어 표기 그 자체는
// abbreviation, 하이픈을 푼 변형은 alias). seen을 지우면 이 용어가 terms에
// 두 번 실린다 — 도달 가능한 회귀다. 같은 fixture가 R100의
// abbreviation > alias 쌍을 DB 경로(단위 테스트가 아니라 실제 쿼리)로도
// 검증한다.
test("R103: 한 용어가 같은 키를 두 kind로 가지면 terms는 한 번만 실린다", async () => {
  const dup = await createTerm(
    {
      termType: "abbreviation",
      nameEn: "ZDK",
      domain: ["QA"],
      status: "active",
      surfaces: [{ text: "Z-D-K", lang: "en", kind: "alias" }],
    },
    null,
  );
  ids.push(dup.term.id);

  const [result] = await lookupTerms(["ZDK"]);
  expect(result!.found).toBe(true);
  expect(result!.terms).toHaveLength(1);
  expect(result!.terms[0]!.id).toBe(dup.term.id);
  expect(result!.matchKind).toBe("abbreviation");
});

// R102: keys[index] -> keys[0] 같은 회귀는 혼합 배치에서 미등록 표기를
// "등록됨"으로 오보고한다 — 린터 입장에서 최악의 오탐이다. found 패턴과
// 서로 다른 인덱스가 서로 다른(정확한) term을 가리키는지를 함께 본다.
test("R102: 혼합 배치에서 각 결과가 자기 인덱스의 텍스트에 대응한다", async () => {
  const second = await createTerm(
    { termType: "term", nameEn: "IndexCorrespondenceProbeTwo", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  ids.push(second.term.id);

  const results = await lookupTerms([
    "AE",
    "UnregisteredIndexProbeOneZzq",
    "IndexCorrespondenceProbeTwo",
    "UnregisteredIndexProbeThreeZzq",
  ]);
  expect(results.map((r) => r.found)).toEqual([true, false, true, false]);
  expect(results[0]!.terms[0]!.id).toBe(ae.term.id);
  expect(results[2]!.terms[0]!.id).toBe(second.term.id);
  expect(results[0]!.terms[0]!.id).not.toBe(results[2]!.terms[0]!.id);
});

// R101: R84는 db.execute 호출 "횟수"만 세고, R89/R88은 미등록 키가 1개뿐이라
// PARTITION BY/상위 3개 컷/정렬을 하나도 건드리지 않는다. 미등록 키 2개
// (gamma.../delta...) 각각에 후보 4개씩을 두고 — 그중 한 후보(gDual)는
// 표기가 2개인 용어로 만들어 MAX(similarity)가 실제로 "더 닮은 쪽"을 고르는지
// 까지 함께 확인한다. 후보들은 미리 psql로 similarity() 점수를 실측해
// (0.8636/0.8261/0.7917/0.76, 동률 없음) 상위 3개 컷과 순서가 결정적이 되도록
// 골랐다.
test("R101: 유사어 쿼리는 파티션 · 상위 3개 컷 · 정렬 · MAX 집계를 실제로 지킨다", async () => {
  const a1 = await createTerm(
    { termType: "term", nameEn: "gammarankprobekeyxqp", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const a2 = await createTerm(
    { termType: "term", nameEn: "gammarankprobekeyxqpx", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const aDual = await createTerm(
    {
      termType: "term",
      nameEn: "gammarankprobekeyxqpxy",
      domain: ["QA"],
      status: "active",
      surfaces: [{ text: "gammarankprobekeyxqpxyzabc", lang: "en", kind: "alias" }],
    },
    null,
  );
  const a4 = await createTerm(
    { termType: "term", nameEn: "gammarankprobekeyxqpxyz", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const b1 = await createTerm(
    { termType: "term", nameEn: "deltarankprobekeyxqp", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const b2 = await createTerm(
    { termType: "term", nameEn: "deltarankprobekeyxqpx", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const b3 = await createTerm(
    { termType: "term", nameEn: "deltarankprobekeyxqpxy", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  const b4 = await createTerm(
    { termType: "term", nameEn: "deltarankprobekeyxqpxyz", domain: ["QA"], status: "active", surfaces: [] },
    null,
  );
  for (const t of [a1, a2, aDual, a4, b1, b2, b3, b4]) ids.push(t.term.id);

  const [resultA, resultB] = await lookupTerms(["gammarankprobekeyxq", "deltarankprobekeyxq"]);
  expect(resultA!.found).toBe(false);
  expect(resultB!.found).toBe(false);

  // ①②③: 파티션이 살아 있고(키별로 자기 후보만), 상위 3개만, score 내림차순
  // "순서까지" 고정한다 — 배열 순서를 그대로 비교하므로 ASC로 뒤집히면
  // (M9) 바로 깨진다. a4/b4가 빠져 있다는 사실이 상위 3개 컷(M8)을 잠근다.
  expect(resultA!.similar.map((s) => s.slug)).toEqual([a1.term.slug, a2.term.slug, aDual.term.slug]);
  expect(resultB!.similar.map((s) => s.slug)).toEqual([b1.term.slug, b2.term.slug, b3.term.slug]);
  for (let i = 0; i < resultA!.similar.length - 1; i += 1) {
    expect(resultA!.similar[i]!.score).toBeGreaterThanOrEqual(resultA!.similar[i + 1]!.score);
  }

  // ④: aDual은 표기가 2개다. 보고되는 score는 그 중 "더 닮은 쪽"과 같아야
  // 한다(MAX->MIN이면 더 낮은 쪽으로 바뀐다). 매직 넘버를 박지 않고, 실제
  // DB에 저장된 두 표기의 normLoose로 similarity()를 직접 재질의해서 비교한다.
  const dualSurfaces = await db
    .select({ normLoose: termSurfaces.normLoose })
    .from(termSurfaces)
    .where(eq(termSurfaces.termId, aDual.term.id));
  expect(dualSurfaces.length).toBe(2);
  const perSurfaceScores = await Promise.all(
    dualSurfaces.map(async (s) => {
      const [row] = await db.execute<{ sim: number }>(
        sql`select similarity(${s.normLoose}, ${"gammarankprobekeyxq"}) as sim`,
      );
      return row!.sim;
    }),
  );
  const expectedMax = Math.max(...perSurfaceScores);
  const dualEntry = resultA!.similar.find((s) => s.slug === aDual.term.slug);
  expect(dualEntry).toBeDefined();
  expect(dualEntry!.score).toBeCloseTo(expectedMax, 5);
});

// R104: 500 상한은 계획서가 명시한 유일한 DB 점유 방어선이다(R84 전체가 그
// 상한을 전제로 설계됐다). 상한이 사라져도, 빈 배열 거부가 사라져도 163/163
// 그린이었다 — 세 번의 왕복으로 세 경계를 모두 잠근다.
test("R104: texts는 500개까지 허용하고 501개는 거부하며 빈 배열도 거부한다", async () => {
  const token = await makeReadKey();

  const cap = Array.from({ length: 500 }, (_, i) => `Cap500Probe${i}`);
  const okRes = await lookupPost(lookupRequest(cap, token));
  expect(okRes.status).toBe(200);

  const over = Array.from({ length: 501 }, (_, i) => `Cap501Probe${i}`);
  const overRes = await lookupPost(lookupRequest(over, token));
  expect(overRes.status).toBe(400);
  expect((await overRes.json()).error.code).toBe("validation_failed");

  const emptyRes = await lookupPost(lookupRequest([], token));
  expect(emptyRes.status).toBe(400);
  expect((await emptyRes.json()).error.code).toBe("validation_failed");
});

// R106: .orderBy(terms.slug)를 지워도 아무 테스트가 울지 않았다 — 기존 R85
// 테스트는 id를 정렬해서 비교하므로 순서를 고정하지 않는다. 슬러그 오름차순과
// "생성 순서"가 반대가 되도록 fixture를 짜서(Z먼저, A나중) 순서 보장이 실제로
// SQL의 orderBy에서 오는 것이지 우연한 삽입 순서가 아님을 확인한다.
test("R106: 동음이의 결과는 slug 오름차순으로 고정된다", async () => {
  const zTerm = await createTerm(
    {
      termType: "term",
      nameEn: "ZOrderProbeXQ",
      domain: ["QA"],
      status: "active",
      surfaces: [{ text: "OrderProbeSharedXQ", lang: "en", kind: "alias" }],
    },
    null,
  );
  ids.push(zTerm.term.id);
  const aTerm = await createTerm(
    {
      termType: "term",
      nameEn: "AOrderProbeXQ",
      domain: ["QA"],
      status: "active",
      surfaces: [{ text: "OrderProbeSharedXQ", lang: "en", kind: "alias" }],
    },
    null,
  );
  ids.push(aTerm.term.id);

  const [result] = await lookupTerms(["OrderProbeSharedXQ"]);
  expect(result!.terms.map((t) => t.id)).toEqual([aTerm.term.id, zTerm.term.id]);
});

// R105: RESERVED_SLUGS는 손으로 유지되는 리터럴이다 — app/api/v1/terms/ 밑에
// 정적 세그먼트가 하나라도 더 생기는데 예약어 목록을 안 갱신하면 R86이 조용히
// 재발한다. 정적(비-[..]) 자식 디렉터리가 전부 RESERVED_SLUGS에 있는지 구조적으로
// 검증한다.
function staticChildDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("["))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// R107: 이 가드의 핵심은 vacuity다. staticChildDirNames는 readdirSync가 실패하면
// []를 돌려주므로(경로 오타 등), 길이를 보지 않으면 "정적 세그먼트가 하나도 없다"와
// "디렉터리를 아예 못 찾았다"가 똑같이 통과한다. 반드시 있어야 하는 세그먼트를
// 하나 지목해서 둘을 구분한다.
test("R107: app/api/v1/terms/ 밑 정적 세그먼트는 전부 RESERVED_SLUGS에 있다", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const apiTermsDir = path.join(testDir, "..", "src", "app", "api", "v1", "terms");

  const apiSegments = staticChildDirNames(apiTermsDir);
  expect(apiSegments).toContain("lookup"); // vacuity 가드: 최소 "lookup"은 항상 존재해야 한다.
  for (const seg of apiSegments) {
    expect(RESERVED_SLUGS.has(seg)).toBe(true);
  }
});

// R107/R135: 이 테스트가 원래 지키던 `app/terms/`는 이제 없다. 슬러그는
// `app/w/[slug]` 한 곳에만 살고 그 옆에 정적 형제가 없으므로, 화면 라우트가
// 슬러그를 가로채는 R86/R92류 충돌은 구조적으로 사라졌다 — 그 사실 자체를
// 단언해 둔다(누군가 `app/w/` 밑에 정적 세그먼트를 만들면 곧바로 실패한다).
test("R135: 슬러그는 app/w/[slug]에만 살고, app/w/ 밑에 정적 형제가 없다", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const wDir = path.join(testDir, "..", "src", "app", "w");

  expect(existsSync(path.join(wDir, "[slug]", "page.tsx"))).toBe(true); // vacuity 가드
  expect(staticChildDirNames(wDir)).toEqual([]);
});

// 다만 예약어가 필요 없어진 건 아니다. 옛 주소를 살리는 next.config.ts의
// 리다이렉트가 그 자리를 물려받는다 — 리다이렉트는 파일시스템보다 먼저
// 검사되므로 `/terms/new`는 슬러그가 무엇이든 생성 폼(`/new`)으로 간다. 즉
// 슬러그가 "new"인 용어의 **옛 링크**는 상세 화면에 영원히 닿지 못한다(R92와
// 같은 형태의 조용한 도달 불가). 리다이렉트 source의 정적 세그먼트가 전부
// RESERVED_SLUGS에 있는지로, 손으로 유지되는 두 리터럴을 묶어 둔다.
test("R135: /terms/* 리다이렉트 source의 정적 세그먼트는 전부 RESERVED_SLUGS에 있다", () => {
  const staticSegments = legacyRedirects
    .map((r) => r.source.split("/").filter(Boolean))
    .filter((segs) => segs[0] === "terms" && segs.length > 1)
    .map((segs) => segs[1]!)
    .filter((seg) => !seg.startsWith(":"));

  expect(staticSegments).toContain("new"); // vacuity 가드
  for (const seg of staticSegments) {
    expect(RESERVED_SLUGS.has(seg)).toBe(true);
  }
});
