import { expect, test } from "vitest";
import {
  activeFilters,
  buildPageHref,
  hiddenSearchFields,
  paginationInfo,
  parseListParams,
  parsePage,
} from "../src/lib/terms/list-params.js";

// R97: "구현을 지워도 통과하는 테스트는 없느니만 못하다" — /terms 화면 자체는
// jsdom/RTL 없이 렌더 테스트를 하지 않는다(M1 범위 밖). 대신 틀릴 수 있는 로직을
// 전부 이 파일의 순수 함수로 뽑아 여기서 검증한다.

// R90: enum 좁히기 — 알 수 없는 값은 400이 아니라 undefined로, 빈 문자열도
// undefined로 취급한다(API 라우트의 parseEnumParam(R91)과 반대 결론).
test("parseListParams: 알 수 없는 type/status 값은 조용히 무시된다", () => {
  const parsed = parseListParams({ type: "not-a-real-type", status: "also-fake" });
  expect(parsed.type).toBeUndefined();
  expect(parsed.status).toBeUndefined();
});

test("parseListParams: 빈 문자열 type/status/domain/q는 지정 안 함으로 취급된다", () => {
  const parsed = parseListParams({ type: "", status: "", domain: "", q: "" });
  expect(parsed.type).toBeUndefined();
  expect(parsed.status).toBeUndefined();
  expect(parsed.domain).toBeUndefined();
  expect(parsed.q).toBeUndefined();
});

test("parseListParams: 알려진 type/status 값은 그대로 통과한다", () => {
  const parsed = parseListParams({ type: "abbreviation", status: "forbidden", domain: "ISP", q: "AE" });
  expect(parsed.type).toBe("abbreviation");
  expect(parsed.status).toBe("forbidden");
  expect(parsed.domain).toBe("ISP");
  expect(parsed.q).toBe("AE");
});

// searchParams가 같은 키를 두 번 받으면 Next는 string[]을 준다(예: ?type=a&type=b).
// 첫 값만 쓴다 — 배열이 그대로 listTerms로 흘러가 타입 오류나 잘못된 SQL 비교로
// 이어지면 안 된다.
test("parseListParams: 같은 키가 배열로 오면 첫 값만 사용한다", () => {
  const parsed = parseListParams({ type: ["abbreviation", "term"], q: ["first", "second"] });
  expect(parsed.type).toBe("abbreviation");
  expect(parsed.q).toBe("first");
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
});

// R93/R94: 쿼리스트링 보존 — 현재 필터가 그대로 실리고 page만 바뀌는지. 이
// 저장소 기준으로 R93/R94를 실제로 방어하는 유일한 테스트다.
test("buildPageHref: 활성 필터(q/type/domain/status)를 전부 보존하며 page만 바뀐다", () => {
  const parsed = parseListParams({ q: "AE", type: "abbreviation", domain: "ISP", status: "approved", page: "1" });
  const href = buildPageHref(parsed, 2);

  const url = new URL(href, "http://x");
  expect(url.pathname).toBe("/terms");
  expect(url.searchParams.get("q")).toBe("AE");
  expect(url.searchParams.get("type")).toBe("abbreviation");
  expect(url.searchParams.get("domain")).toBe("ISP");
  expect(url.searchParams.get("status")).toBe("approved");
  expect(url.searchParams.get("page")).toBe("2");
});

test("buildPageHref: 필터가 없으면 page만 실린다", () => {
  const parsed = parseListParams({});
  const href = buildPageHref(parsed, 3);
  const url = new URL(href, "http://x");
  expect([...url.searchParams.keys()]).toEqual(["page"]);
  expect(url.searchParams.get("page")).toBe("3");
});

// R94: 검색 폼의 hidden input은 type/domain/status만 실어야 한다 — q는 이미
// 폼의 보이는 입력이라 hidden으로 다시 실으면 안 되고, page는 새 검색이니
// 1페이지로 가야 하므로 애초에 hiddenSearchFields의 관심사가 아니다(반환값에
// page라는 이름 자체가 없다).
test("hiddenSearchFields: q는 제외하고 type/domain/status만 반환한다", () => {
  const parsed = parseListParams({ q: "AE", type: "abbreviation", domain: "ISP", status: "approved" });
  const fields = hiddenSearchFields(parsed);
  const names = fields.map((f) => f.name).sort();
  expect(names).toEqual(["domain", "status", "type"]);
  expect(fields.find((f) => f.name === "domain")?.value).toBe("ISP");
});

test("hiddenSearchFields: 활성 필터가 없으면 빈 배열이다", () => {
  const parsed = parseListParams({ q: "AE" });
  expect(hiddenSearchFields(parsed)).toEqual([]);
});

test("activeFilters: 지정된 필터만, 지정 순서(q/type/domain/status)로 반환한다", () => {
  const parsed = parseListParams({ status: "draft", q: "gain", type: "term" });
  expect(activeFilters(parsed)).toEqual([
    { name: "q", value: "gain" },
    { name: "type", value: "term" },
    { name: "status", value: "draft" },
  ]);
});
