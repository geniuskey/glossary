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
//      (LIKE 'ae%'는 "ae-algorithm" 같은 무관한 슬러그까지 지우므로 후보만 LIKE로
//      좁히고 최종 삭제는 JS 정규식으로 재확인한다).
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
  ids.push(ae.term.id, hw.term.id);
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

test("동음이의어를 상세에 함께 싣는다", async () => {
  const detail = await getTermByIdOrSlug(aeSlug);
  expect(detail?.homonyms.map((h) => h.id)).toContain(ids[1]);
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
// 동작은 terms-list-route.test.ts에서 별도로 확인한다. 여기서는 listTerms가
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
