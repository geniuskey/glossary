import { expect, test } from "vitest";
import {
  activeFilters,
  activeParams,
  buildFilterHref,
  buildPageHref,
  buildPageSizeHref,
  buildSortHref,
  hiddenSearchFields,
  paginationInfo,
  parseListParams,
  parsePage,
  parsePageSize,
  sortStateOf,
} from "../src/lib/terms/list-params.js";
import { DOMAIN_VALUE_MAX, TERM_QUERY_MAX } from "../src/lib/terms/limits.js";

// R97: "구현을 지워도 통과하는 테스트는 없느니만 못하다" — /terms 화면 자체는
// jsdom/RTL 없이 렌더 테스트를 하지 않는다(M1 범위 밖). 대신 틀릴 수 있는 로직을
// 전부 이 파일의 순수 함수로 뽑아 여기서 검증한다.

// R90: enum 좁히기 — 알 수 없는 값은 400이 아니라 undefined로, 빈 문자열도
// undefined로 취급한다(API 라우트의 parseEnumParam(R91)과 반대 결론).
test("parseListParams: 알 수 없는 status 값은 조용히 무시된다", () => {
  const parsed = parseListParams({ status: "also-fake" });
  expect(parsed.status).toBeUndefined();
});

test("parseListParams: 빈 문자열 status/domain/category/topic/q는 지정 안 함으로 취급된다", () => {
  const parsed = parseListParams({ status: "", domain: "", category: "", topic: "", q: "" });
  expect(parsed.status).toBeUndefined();
  expect(parsed.domain).toBeUndefined();
  expect(parsed.category).toBeUndefined();
  expect(parsed.q).toBeUndefined();
});

test("parseListParams: status와 관리형 category key를 그대로 통과한다", () => {
  const parsed = parseListParams({ status: "forbidden", domain: "ISP", category: "무선", q: "AE" });
  expect(parsed.status).toBe("forbidden");
  expect(parsed.domain).toBe("ISP");
  expect(parsed.category).toBe("무선");
  expect(parsed.topic).toBeUndefined();
  expect(parsed.q).toBe("AE");
});

// searchParams가 같은 키를 두 번 받으면 Next는 string[]을 준다.
// 첫 값만 쓴다 — 배열이 그대로 listTerms로 흘러가 타입 오류나 잘못된 SQL 비교로
// 이어지면 안 된다.
test("parseListParams: 같은 키가 배열로 오면 첫 값만 사용한다", () => {
  const parsed = parseListParams({ q: ["first", "second"] });
  expect(parsed.q).toBe("first");
});

test("parseListParams: 사람이 주소창에 넣은 긴 검색어와 도메인은 안전한 길이로 자른다", () => {
  const parsed = parseListParams({
    q: "q".repeat(TERM_QUERY_MAX + 10),
    domain: "d".repeat(DOMAIN_VALUE_MAX + 10),
  });
  expect(parsed.q).toHaveLength(TERM_QUERY_MAX);
  expect(parsed.domain).toHaveLength(DOMAIN_VALUE_MAX);
});

// R90/R97: page 클램프 — 0, -1, "abc", "1e999", 소수.
test("parsePage: page=0과 page=-1은 1로 클램프된다", () => {
  expect(parsePage("0")).toBe(1);
  expect(parsePage("-1")).toBe(1);
});

test("parsePage: page=abc(형식 오류)는 400이 아니라 기본값 1이 된다", () => {
  expect(parsePage("abc")).toBe(1);
});

test("parsePage: page=1e999(Number()가 Infinity를 주는 입력)는 1이 된다", () => {
  expect(parsePage("1e999")).toBe(1);
});

test("parsePage: 소수는 내림해서 정수가 된다", () => {
  expect(parsePage("2.7")).toBe(2);
  expect(parsePage("2.999")).toBe(2);
});

test("parsePage: 지정 안 함/빈 문자열은 기본값 1이다", () => {
  expect(parsePage(undefined)).toBe(1);
  expect(parsePage("")).toBe(1);
});

test("parsePage: 유효한 양의 정수 문자열은 그대로 통과한다", () => {
  expect(parsePage("3")).toBe(3);
});

// F1: "1e999"는 Number.isFinite 게이트에 걸려 1이 되지만(위 테스트), "1e20"은
// 유한하면서 거대한 값이라 그 게이트를 그냥 통과한다. 상한 클램프가 없으면
// listTerms의 offset 계산이 bigint 범위를 넘겨 실제 DB 호출에서
// "invalid input syntax for type bigint"가 던져진다(review §3 F1). API
// 라우트가 이미 쓰는 것과 같은 상한(Number.MAX_SAFE_INTEGER)으로 클램프됨을
// 확인한다.
test("parsePage: page=1e20(유한하지만 거대한 값)은 MAX_SAFE_INTEGER로 클램프된다 (F1)", () => {
  expect(parsePage("1e20")).toBe(Number.MAX_SAFE_INTEGER);
});

test("parsePageSize: 기본값은 50이고 1~1000 범위로 클램프된다", () => {
  expect(parsePageSize(undefined)).toBe(50);
  expect(parsePageSize("abc")).toBe(50);
  expect(parsePageSize("0")).toBe(1);
  expect(parsePageSize("250.9")).toBe(250);
  expect(parsePageSize("1000")).toBe(1000);
  expect(parsePageSize("5000")).toBe(1000);
});

// R93: 페이지네이션 계산 — totalPages, 이전/다음 존재 여부, 경계.
test("paginationInfo: total=0이면 totalPages=0이고 이전/다음 모두 없다", () => {
  const info = paginationInfo(1, 0, 20);
  expect(info.totalPages).toBe(0);
  expect(info.hasPrev).toBe(false);
  expect(info.hasNext).toBe(false);
});

test("paginationInfo: total=20/pageSize=20이면 딱 1페이지고 이전/다음 모두 없다", () => {
  const info = paginationInfo(1, 20, 20);
  expect(info.totalPages).toBe(1);
  expect(info.hasPrev).toBe(false);
  expect(info.hasNext).toBe(false);
});

test("paginationInfo: total=21/pageSize=20이면 2페이지고 1페이지에서는 다음만 있다", () => {
  const info = paginationInfo(1, 21, 20);
  expect(info.totalPages).toBe(2);
  expect(info.hasPrev).toBe(false);
  expect(info.hasNext).toBe(true);
});

test("paginationInfo: total=21/pageSize=20의 2페이지에서는 이전만 있다", () => {
  const info = paginationInfo(2, 21, 20);
  expect(info.totalPages).toBe(2);
  expect(info.hasPrev).toBe(true);
  expect(info.hasNext).toBe(false);
});

test("paginationInfo: page가 totalPages를 넘어가도(빈 결과 페이지) 다음은 없고 이전은 있다", () => {
  const info = paginationInfo(5, 21, 20);
  expect(info.totalPages).toBe(2);
  expect(info.hasPrev).toBe(true);
  expect(info.hasNext).toBe(false);
  // F5: page가 인자 그대로 돌아오는지 아무도 단언하지 않았다 — paginationInfo가
  // page를 1로 고정해도(회귀) 위 세 단언은 전부 그대로 통과했다. page=1이 아닌
  // 입력에서 확인해야 하드코딩 회귀를 실제로 잡는다.
  expect(info.page).toBe(5);
});

// R93/R94: 쿼리스트링 보존 — 현재 필터가 그대로 실리고 page만 바뀌는지. 이
// 저장소 기준으로 R93/R94를 실제로 방어하는 유일한 테스트다.
test("buildPageHref: 활성 필터(q/domain/category/topic/status)를 전부 보존하며 page만 바뀐다", () => {
  const parsed = parseListParams({ q: "AE", domain: "ISP", category: "design", topic: "무선", status: "active", page: "1" });
  const href = buildPageHref(parsed, 2);

  const url = new URL(href, "http://x");
  expect(url.pathname).toBe("/sheet");
  expect(url.searchParams.get("q")).toBe("AE");
  expect(url.searchParams.get("domain")).toBe("ISP");
  expect(url.searchParams.get("category")).toBe("design");
  expect(url.searchParams.get("topic")).toBe("무선");
  expect(url.searchParams.get("status")).toBe("active");
  expect(url.searchParams.get("page")).toBe("2");
});

test("buildPageHref: 필터가 없으면 page만 실린다", () => {
  const parsed = parseListParams({});
  const href = buildPageHref(parsed, 3);
  const url = new URL(href, "http://x");
  expect([...url.searchParams.keys()]).toEqual(["page"]);
  expect(url.searchParams.get("page")).toBe("3");
});

// R94: 검색 폼의 hidden input은 domain/category/status만 실어야 한다 — q는 이미
// 폼의 보이는 입력이라 hidden으로 다시 실으면 안 되고, page는 새 검색이니
// 1페이지로 가야 하므로 애초에 hiddenSearchFields의 관심사가 아니다(반환값에
// page라는 이름 자체가 없다).
test("hiddenSearchFields: q는 제외하고 domain/category/topic/status만 반환한다", () => {
  const parsed = parseListParams({ q: "AE", domain: "ISP", category: "design", topic: "무선", status: "active" });
  const fields = hiddenSearchFields(parsed);
  const names = fields.map((f) => f.name).sort();
  expect(names).toEqual(["category", "domain", "status", "topic"]);
  expect(fields.find((f) => f.name === "domain")?.value).toBe("ISP");
});

test("hiddenSearchFields: 활성 필터가 없으면 빈 배열이다", () => {
  const parsed = parseListParams({ q: "AE" });
  expect(hiddenSearchFields(parsed)).toEqual([]);
});

test("activeFilters: 지정된 필터만, 지정 순서(q/domain/category/topic/status)로 반환한다", () => {
  const parsed = parseListParams({ status: "active", q: "gain", category: "design", topic: "RF" });
  expect(activeFilters(parsed)).toEqual([
    { name: "q", value: "gain" },
    { name: "category", value: "design" },
    { name: "topic", value: "RF" },
    { name: "status", value: "active" },
  ]);
});

// --- 정렬 -----------------------------------------------------------------
// 정렬은 필터와 달리 "보는 방식"이지만 주소에 실려야 한다 — 열 머리글을 눌러
// 정렬한 뒤 새로고침하거나 링크를 공유했을 때 정렬이 풀리면 함께 보는 화면으로
// 쓸모가 없다. 아래 테스트들이 그 보존을 고정한다.

test("parseListParams: 알 수 없는 sort/dir은 조용히 무시된다", () => {
  const parsed = parseListParams({ sort: "nameFr", dir: "sideways" });
  expect(parsed.sort).toBeUndefined();
  expect(parsed.dir).toBeUndefined();
});

test("parseListParams: 알려진 sort/dir은 그대로 통과한다", () => {
  const parsed = parseListParams({ sort: "nameKo", dir: "asc" });
  expect(parsed.sort).toBe("nameKo");
  expect(parsed.dir).toBe("asc");
});

test("buildSortHref: 다른 열을 누르면 그 열의 기본 방향으로 새로 정렬한다", () => {
  const parsed = parseListParams({ sort: "updatedAt", dir: "desc" });
  const href = buildSortHref(parsed, "nameEn", "asc");
  const usp = new URLSearchParams(href.split("?")[1]);
  expect(usp.get("sort")).toBe("nameEn");
  expect(usp.get("dir")).toBe("asc");
});

test("buildSortHref: 같은 열을 다시 누르면 방향만 뒤집힌다", () => {
  const asc = parseListParams({ sort: "nameEn", dir: "asc" });
  expect(new URLSearchParams(buildSortHref(asc, "nameEn", "asc").split("?")[1]).get("dir")).toBe("desc");

  const desc = parseListParams({ sort: "nameEn", dir: "desc" });
  expect(new URLSearchParams(buildSortHref(desc, "nameEn", "asc").split("?")[1]).get("dir")).toBe("asc");
});

test("buildSortHref: sort/dir이 없으면 기본 정렬(updatedAt desc)을 현재 상태로 본다", () => {
  const parsed = parseListParams({});
  // 기본이 updatedAt desc이므로, updatedAt을 누르면 asc로 뒤집혀야 한다.
  expect(new URLSearchParams(buildSortHref(parsed, "updatedAt", "desc").split("?")[1]).get("dir")).toBe("asc");
});

test("buildSortHref: 활성 필터를 전부 보존하고 page는 1로 되돌린다", () => {
  const parsed = parseListParams({ q: "AE", domain: "ISP", category: "design", topic: "무선", status: "active", page: "7" });
  const usp = new URLSearchParams(buildSortHref(parsed, "slug", "asc").split("?")[1]);
  expect(usp.get("q")).toBe("AE");
  expect(usp.get("domain")).toBe("ISP");
  expect(usp.get("category")).toBe("design");
  expect(usp.get("topic")).toBe("무선");
  expect(usp.get("status")).toBe("active");
  // 정렬이 바뀌면 7페이지에 있던 행들은 그 자리에 없다.
  expect(usp.get("page")).toBe("1");
});

test("buildPageHref: 정렬도 함께 보존한다(필터만 보존하면 페이지를 넘길 때 정렬이 풀린다)", () => {
  const parsed = parseListParams({ sort: "nameKo", dir: "asc", page: "2" });
  const usp = new URLSearchParams(buildPageHref(parsed, 3).split("?")[1]);
  expect(usp.get("sort")).toBe("nameKo");
  expect(usp.get("dir")).toBe("asc");
  expect(usp.get("page")).toBe("3");
});

test("페이지 크기는 페이지 이동·필터·정렬에서 유지되고 크기를 바꾸면 1페이지로 돌아간다", () => {
  const parsed = parseListParams({ q: "AE", sort: "nameKo", dir: "asc", page: "4", pageSize: "500" });

  expect(new URL(buildPageHref(parsed, 5), "http://x").searchParams.get("pageSize")).toBe("500");
  expect(new URL(buildFilterHref(parsed, "q"), "http://x").searchParams.get("pageSize")).toBe("500");
  expect(new URL(buildSortHref(parsed, "slug", "asc"), "http://x").searchParams.get("pageSize")).toBe("500");

  const resized = new URL(buildPageSizeHref(parsed, 1000), "http://x");
  expect(resized.searchParams.get("pageSize")).toBe("1000");
  expect(resized.searchParams.get("page")).toBe("1");
  expect(resized.searchParams.get("q")).toBe("AE");
});

test("buildFilterHref: 지정한 필터 하나만 빠지고 정렬과 나머지 필터는 남는다", () => {
  const parsed = parseListParams({ q: "AE", domain: "ISP", sort: "slug", dir: "asc", page: "4" });
  const usp = new URLSearchParams(buildFilterHref(parsed, "domain").split("?")[1]);
  expect(usp.get("domain")).toBeNull();
  expect(usp.get("q")).toBe("AE");
  expect(usp.get("sort")).toBe("slug");
  expect(usp.get("dir")).toBe("asc");
  // 필터가 바뀌면 결과 집합 자체가 달라진다.
  expect(usp.get("page")).toBe("1");
});

test("hiddenSearchFields: 정렬도 hidden으로 실린다(검색 제출 시 정렬이 풀리면 안 된다)", () => {
  const parsed = parseListParams({ q: "AE", sort: "nameEn", dir: "asc" });
  const names = hiddenSearchFields(parsed).map((f) => f.name).sort();
  expect(names).toEqual(["dir", "sort"]);
});

test("activeParams: q는 빠지지 않는다(hiddenSearchFields만 q를 뺀다)", () => {
  const parsed = parseListParams({ q: "AE", sort: "nameEn" });
  expect(activeParams(parsed).map((f) => f.name)).toEqual(["q", "sort"]);
});

test("sortStateOf: 정렬 중인 열만 방향을 돌려주고 나머지는 null이다", () => {
  const parsed = parseListParams({ sort: "nameEn", dir: "asc" });
  expect(sortStateOf(parsed, "nameEn")).toBe("asc");
  expect(sortStateOf(parsed, "slug")).toBeNull();

  // 지정이 없으면 기본 정렬(updatedAt desc)이 현재 상태다.
  const bare = parseListParams({});
  expect(sortStateOf(bare, "updatedAt")).toBe("desc");
  expect(sortStateOf(bare, "nameEn")).toBeNull();
});
