import { eq, or } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { getTermByIdOrSlug, listTerms } from "../src/lib/terms/query.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];

// R43: terms-create.test.ts도 nameEn "AE" -> slug "ae"로 같은 fixture를 만든다.
// 파일은 순차 실행되지만(fileParallelism: false), 그 파일이 afterEach/afterAll을
// 못 돌고 죽으면 "ae"가 남아있을 수 있다. 그러면 여기서 만드는 createTerm은
// "ae-2"를 받고, getTermByIdOrSlug("ae")로 문자열을 고정해 조회하면 남의 stale
// row를 조용히 읽게 된다. 그래서:
//   1) beforeAll에서 이 파일이 쓰는 슬러그 패턴을 앵커링된 정규식으로 먼저 지운다
//      (후보는 정확히 "ae"/"ae-2"/"ae-3" 세 개의 eq로만 좁히고, 최종 삭제는 JS
//      정규식으로 재확인한다 — LIKE는 쓰지 않는다. F9(리뷰): 이전 버전 주석이
//      "LIKE 'ae%'로 좁힌다"고 잘못 적혀 있었다).
//   2) 이후 모든 단언은 literal slug("ae")가 아니라 createTerm이 실제로 반환한
//      ae.term.slug를 사용한다.
async function purgeFixtures() {
  const exactPattern = /^ae(-\d+)?$/;
  const candidates = await db
    .select({ id: terms.id, slug: terms.slug })
    .from(terms)
    .where(or(eq(terms.slug, "ae"), eq(terms.slug, "ae-2"), eq(terms.slug, "ae-3")));
  const ids2 = candidates.filter((r) => exactPattern.test(r.slug)).map((r) => r.id);
  for (const id of ids2) await db.delete(terms).where(eq(terms.id, id));
}

let aeSlug = "";

beforeAll(async () => {
  await purgeFixtures();

  const ae = await createTerm(
    {
      termType: "abbreviation",
      nameEn: "AE",
      fullNameEn: "Auto Exposure",
      nameKo: "자동노출",
      domain: ["ISP"],
      status: "approved",
      surfaces: [{ text: "오토익스포저", lang: "ko", kind: "discouraged" }],
    },
    null,
  );
  const hw = await createTerm(
    {
      termType: "term",
      nameEn: "AE",
      fullNameEn: "Application Engineer",
      domain: ["PM"],
      status: "approved",
      surfaces: [],
    },
    null,
  );
  // R61(F4): 동음이의어 dedup을 증명하려면 "ae"와 normLoose가 겹치는 표기를
  // *두 개* 가진 term이 필요하다 — "AE"(-> "ae")와 "Auto Exposure"(-> "autoexposure")
  // 둘 다 ae.term의 표기 normLoose와 정확히 같다. selectDistinctOn이 없으면 이
  // term이 homonyms에 두 번 나온다.
  const dupe = await createTerm(
    {
      termType: "term",
      nameEn: "AE Dedup Probe",
      domain: ["QA"],
      status: "approved",
      surfaces: [
        { text: "AE", lang: "en", kind: "discouraged" },
        { text: "Auto Exposure", lang: "en", kind: "discouraged" },
      ],
    },
    null,
  );
  ids.push(ae.term.id, hw.term.id, dupe.term.id);
  aeSlug = ae.term.slug;
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("슬러그로 상세를 조회한다", async () => {
  const detail = await getTermByIdOrSlug(aeSlug);
  expect(detail?.nameEn).toBe("AE");
  expect(detail?.surfaces.length).toBeGreaterThanOrEqual(3);
});

// R60(F3): isUuid 분기의 반대쪽(byId)은 아무도 실행하지 않았다 — query.ts:70의
// 삼항을 뒤집어 UUID도 slug 쪽으로 보내도 그린이었다. term.id로 직접 조회한다.
test("id로 상세를 조회한다 (R60)", async () => {
  const detail = await getTermByIdOrSlug(ids[0]!);
  expect(detail?.slug).toBe(aeSlug);
  expect(detail?.nameEn).toBe("AE");
});

test("동음이의어를 상세에 함께 싣는다", async () => {
  const detail = await getTermByIdOrSlug(aeSlug);
  expect(detail?.homonyms.map((h) => h.id)).toContain(ids[1]);
  // R61(F4): 자기 자신은 동음이의어 목록에 나오면 안 된다 —
  // ne(terms.id, term.id)를 지워도 이 단언이 없으면 그린으로 남는다.
  expect(detail?.homonyms.map((h) => h.id)).not.toContain(ids[0]);
});

// R61(F4): dupe term은 ae의 표기 두 개("ae", "autoexposure")와 동시에 매치되는
// 표기를 가진다 — selectDistinctOn을 평범한 select로 되돌려도 위의
// "동음이의어를 상세에 함께 싣는다" 테스트는 여전히 그린이다(toContain은 중복을
// 못 잡는다). 정확히 한 번만 나오는지 직접 센다.
test("동음이의어는 표기가 여러 개 겹쳐도 한 번만 나온다 (R61)", async () => {
  const detail = await getTermByIdOrSlug(aeSlug);
  const occurrences = detail?.homonyms.filter((h) => h.id === ids[2]) ?? [];
  expect(occurrences.length).toBe(1);
});

test("비권장 표기로 검색해도 해당 용어가 나온다", async () => {
  const { items } = await listTerms({ q: "오토익스포저", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
});

test("표기 변형으로 검색해도 찾는다", async () => {
  const { items } = await listTerms({ q: "auto-exposure", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
});

// "auto-exposure"는 구분자만 다를 뿐 normLoose가 "Auto Exposure"와 정확히
// 같아서("autoexposure"), eq(normLoose) 단독으로도 통과한다 — 위 테스트는
// pg_trgm의 `%` 유사도 연산자를 실제로는 exercise하지 않는다. 오타처럼
// normLoose/normSpace 어느 쪽과도 정확히 같지 않은 질의로 pg_trgm 경로를
// 직접 겨냥한다.
test("오타가 섞인 표기도 pg_trgm 유사도로 찾는다", async () => {
  const { items } = await listTerms({ q: "Auto Exposuer", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
});

test("domain으로 필터링한다", async () => {
  const { items } = await listTerms({ domain: "PM", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[1]);
  expect(items.map((t) => t.id)).not.toContain(ids[0]);
});

test("없는 슬러그는 null을 반환한다", async () => {
  await expect(getTermByIdOrSlug("does-not-exist")).resolves.toBeNull();
});

// R40: TermDetail이 실제로 응답에 없는 컬럼(createdBy 등)을 실어 보내지 않고,
// 인터페이스에 있는 updatedAt은 실어 보내는지 직접 확인한다. 이 단언이 없으면
// getTermByIdOrSlug가 db.select().from(terms) 전체 컬럼을 spread하도록 되돌려도
// 위의 "상세를 조회한다" 테스트는 여전히 그린이다 — nameEn/surfaces만 보기
// 때문이다.
test("상세 응답은 TermDetail 필드만 싣고 원본 테이블의 다른 컬럼은 새지 않는다 (R40)", async () => {
  const detail = await getTermByIdOrSlug(aeSlug);
  expect(detail?.updatedAt).toBeInstanceOf(Date);

  const keys = Object.keys(detail ?? {}).sort();
  expect(keys).toEqual(
    [
      "id", "slug", "termType", "nameEn", "nameKo", "domain", "status",
      "fullNameEn", "fullNameKo", "definitionMd", "bodyMd", "updatedAt",
      "surfaces", "homonyms",
    ].sort(),
  );
});

// R41: 알 수 없는 type/status는 listTerms 자체가 아니라 라우트가 400으로
// 막아야 한다(listTerms는 이미 검증된 값만 받는 내부 함수). 라우트 레벨
// 동작은 terms-route.test.ts에서 별도로 확인한다(F9: 파일명 오기 수정). 여기서는 listTerms가
// 유효한 termType/status로 정확히 필터링하는지만 확인한다.
test("termType으로 필터링한다", async () => {
  const { items } = await listTerms({ termType: "abbreviation", q: "AE", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[0]);
  expect(items.map((t) => t.id)).not.toContain(ids[1]);
});

test("status로 필터링한다", async () => {
  const { items } = await listTerms({ status: "approved", domain: "PM", page: 1, pageSize: 20 });
  expect(items.map((t) => t.id)).toContain(ids[1]);
});

// pagination/total: page/pageSize가 무시되지 않고, total이 매칭 건수 전체(현재
// 페이지 건수가 아니라)를 반영하는지 확인한다. q="AE"는 ae/hw 두 term 모두와
// 매칭되므로(둘 다 nameEn "AE"), pageSize를 1로 좁혀도 total은 여전히 2여야
// 한다 — total을 `items.length`로 잘못 계산하면 이 좁힌 페이지에서 1로
// 줄어들어 잡힌다.
test("pageSize로 페이지당 개수를 제한해도 total은 전체 매칭 건수를 반환한다", async () => {
  const full = await listTerms({ q: "AE", page: 1, pageSize: 20 });
  expect(full.total).toBeGreaterThanOrEqual(2);

  const limited = await listTerms({ q: "AE", page: 1, pageSize: 1 });
  expect(limited.items.length).toBe(1);
  expect(limited.total).toBe(full.total);
});

test("page 2는 1페이지와 다른 결과를 반환한다 (pageSize=1)", async () => {
  const page1 = await listTerms({ q: "AE", page: 1, pageSize: 1 });
  const page2 = await listTerms({ q: "AE", page: 2, pageSize: 1 });
  expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
});

// R63(F6): updatedAt은 defaultNow() = 트랜잭션 시작 시각이라, 한 트랜잭션 안에서
// insert된 두 row는 updatedAt이 완전히 같다. orderBy(desc(updatedAt)) 단독으로는
// 그 동률 아래에서 LIMIT/OFFSET이 안정적이지 않아 같은 행이 여러 페이지에 다시
// 나올 수 있다 — id를 타이브레이커로 추가해야 페이지마다 다른 행이 나온다.
test("updatedAt이 같은 두 term도 페이지마다 다른 결과를 반환한다 (R63)", async () => {
  const domain = `f6-tiebreaker-${Date.now()}`;
  const tieIds = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(terms)
      .values([
        { slug: `${domain}-a`, domain: [domain] },
        { slug: `${domain}-b`, domain: [domain] },
      ])
      .returning({ id: terms.id, updatedAt: terms.updatedAt });
    return rows;
  });
  for (const row of tieIds) ids.push(row.id);
  expect(tieIds[0]!.updatedAt.getTime()).toBe(tieIds[1]!.updatedAt.getTime());

  const page1 = await listTerms({ domain, page: 1, pageSize: 1 });
  const page2 = await listTerms({ domain, page: 2, pageSize: 1 });
  expect(page1.total).toBe(2);
  expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
});
