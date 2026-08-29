import { termStatusEnum, termTypeEnum } from "@grossary/db";
import { DEFAULT_DIR, DEFAULT_SORT, SORT_DIRS, SORT_KEYS, type SortDir, type SortKey } from "./grid";
import type { TermStatus, TermType } from "./query";

// R91: `app/api/v1/terms/route.ts`의 parseEnumParam/parsePageParam은 이 모듈과
// 똑같은 문제(알 수 없는 enum 값, 형식이 잘못된 page)를 다루지만 결론은
// 반대다 — 그 파서는 기계 클라이언트를 상대하므로 알 수 없는 값에 400
// validation_failed를 돌려준다(R41/R59/R64/R65 테스트가 그 계약을 고정한다).
// 이 모듈은 사람이 주소창을 손으로 고치는 `/terms` 화면을 상대한다 — 오타 하나로
// 에러 페이지를 띄우면 안 되므로, 알 수 없는/잘못된 값은 전부 조용히 "지정
// 안 함"·기본값으로 무시한다. 그래서 API 라우트의 파서를 재사용하지 않고 이
// 모듈을 새로 둔다(같은 로직처럼 보여도 실패 시 동작이 달라야 한다).

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedListParams {
  q?: string;
  type?: TermType;
  domain?: string;
  status?: TermStatus;
  // 정렬은 필터가 아니라 "보는 방식"이다. 그래도 주소에 실려야 한다 —
  // 표에서 열 머리글을 눌러 정렬한 뒤 새로고침하거나 링크를 공유했을 때
  // 정렬이 풀려 버리면 함께 보는 화면으로서 쓸모가 없다.
  sort?: SortKey;
  dir?: SortDir;
  page: number;
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value : undefined;
}

// R90: 알 수 없는 값은 undefined로 좁힌다(400을 던지지 않는다). 빈 문자열도
// "지정 안 함"으로 취급한다(select를 아무것도 고르지 않은 채 제출한 폼이
// `type=`을 만들어내는 경우가 이것이다 — API 라우트의 R64와 같은 이유).
function narrowEnum<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const value = firstValue(raw);
  if (value === undefined) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

// R90: `Number("1e999")`는 Infinity, `Number("abc")`는 NaN이다 — 둘 다
// Number.isFinite로 걸러 기본값 1로 되돌린다. 0/음수/소수는 정수로 내림한 뒤
// 최소 1로 클램프한다.
// F1(수정 라운드): 유한하지만 거대한 값(예: "1e20")은 위 게이트를 그냥
// 통과해서 listTerms의 `(page-1)*pageSize`가 bigint 범위를 넘겨 Postgres가
// "invalid input syntax for type bigint"를 던지고, Server Component에는
// withApiErrors 같은 그물이 없어 그대로 Next 에러 페이지가 된다 — R90이
// 막으려던 바로 그 결과다. API 라우트(app/api/v1/terms/route.ts)가 이미
// parsePageParam(..., Number.MAX_SAFE_INTEGER)로 상한을 두는 것과 같은 값으로
// 클램프한다. R91은 실패 신호(400 vs 무시)만 갈라지라고 했지, 범위 클램프까지
// 갈라지라고 하지 않았다.
export function parsePage(raw: string | string[] | undefined): number {
  const value = firstValue(raw);
  if (value === undefined) return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(n)));
}

export function parseListParams(raw: RawSearchParams): ParsedListParams {
  return {
    q: firstValue(raw.q),
    type: narrowEnum(raw.type, termTypeEnum.enumValues),
    domain: firstValue(raw.domain),
    status: narrowEnum(raw.status, termStatusEnum.enumValues),
    sort: narrowEnum(raw.sort, SORT_KEYS),
    dir: narrowEnum(raw.dir, SORT_DIRS),
    page: parsePage(raw.page),
  };
}

export interface PaginationInfo {
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

// R93: totalPages는 그냥 total/pageSize의 올림이다 — total=0이면 0페이지다.
// hasPrev/hasNext는 그 값을 기준으로 그대로 파생하므로, page가 totalPages를
// 넘어가도(빈 결과 페이지) 계산 자체는 안전하다.
export function paginationInfo(page: number, total: number, pageSize: number): PaginationInfo {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

type FilterName = "q" | "type" | "domain" | "status";
type ParamName = FilterName | "sort" | "dir";

// R93/R94: 현재 활성 필터(빈 값이 아닌 것만)를 이름 붙은 목록으로 뽑는다.
// buildPageHref(페이지네이션 링크)와 hiddenSearchFields(검색 폼의 hidden
// input) 둘 다 이 하나의 목록에서 파생돼서, 두 자리의 "필터 보존" 로직이
// 서로 다른 곳에서 따로 갈라지지 않는다.
export function activeFilters(params: ParsedListParams): Array<{ name: FilterName; value: string }> {
  const out: Array<{ name: FilterName; value: string }> = [];
  if (params.q) out.push({ name: "q", value: params.q });
  if (params.type) out.push({ name: "type", value: params.type });
  if (params.domain) out.push({ name: "domain", value: params.domain });
  if (params.status) out.push({ name: "status", value: params.status });
  return out;
}

// R94: 검색 폼의 `q` input은 이미 화면에 보이는 입력창 자신이라, hidden으로
// 다시 실으면 안 된다(값이 두 번 실려 마지막 것이 이기는 것에 우연히 기대게
// 된다). type/domain/status만 hidden으로 실어 검색 제출 시 사라지지 않게 한다.
export function hiddenSearchFields(params: ParsedListParams): Array<{ name: ParamName; value: string }> {
  return activeParams(params).filter((f) => f.name !== "q");
}

// 주소에 실어야 하는 상태 전부 = 필터 + 정렬. 링크를 만드는 자리(페이지네이션,
// 열 머리글, 검색 폼의 hidden input)가 저마다 목록을 다시 적으면 한 곳만 빠뜨려도
// 그 링크에서 조용히 정렬이 풀린다 — R93/R94가 필터에 대해 닫은 구멍과 같다.
export function activeParams(params: ParsedListParams): Array<{ name: ParamName; value: string }> {
  const out: Array<{ name: ParamName; value: string }> = [...activeFilters(params)];
  if (params.sort) out.push({ name: "sort", value: params.sort });
  if (params.dir) out.push({ name: "dir", value: params.dir });
  return out;
}

function hrefWith(params: ParsedListParams, overrides: Partial<Record<ParamName | "page", string>>): string {
  const usp = new URLSearchParams();
  for (const f of activeParams(params)) usp.set(f.name, f.value);
  for (const [name, value] of Object.entries(overrides)) usp.set(name, value);
  return `/terms?${usp.toString()}`;
}

// R93: 페이지네이션 링크. 현재 활성 필터를 전부 보존하면서 page만 targetPage로
// 바꾼다.
export function buildPageHref(params: ParsedListParams, targetPage: number): string {
  return hrefWith(params, { page: String(targetPage) });
}

/**
 * 필터 칩의 "x". 그 필터 하나만 빼고 나머지(정렬 포함)는 유지한다. 필터가
 * 바뀌면 결과 집합 자체가 달라지므로 page는 1로 되돌린다.
 */
export function buildFilterHref(params: ParsedListParams, drop: FilterName): string {
  const usp = new URLSearchParams();
  for (const f of activeParams(params)) {
    if (f.name !== drop) usp.set(f.name, f.value);
  }
  usp.set("page", "1");
  return `/terms?${usp.toString()}`;
}

/**
 * 열 머리글 링크. 이미 그 열로 정렬 중이면 방향만 뒤집고, 아니면 그 열의
 * 기본 방향으로 새로 정렬한다. 정렬이 바뀌면 지금 보던 page 번호는 의미가
 * 없어지므로(다른 행들이 그 자리에 온다) 항상 1페이지로 돌아간다.
 */
export function buildSortHref(params: ParsedListParams, key: SortKey, fallbackDir: SortDir): string {
  const current = params.sort ?? DEFAULT_SORT;
  const currentDir = params.dir ?? DEFAULT_DIR;
  const dir: SortDir = current === key ? (currentDir === "asc" ? "desc" : "asc") : fallbackDir;
  return hrefWith(params, { sort: key, dir, page: "1" });
}

/**
 * 머리글 우클릭 메뉴의 "오름차순 / 내림차순"이 쓰는 링크. buildSortHref와 달리
 * 방향을 못 박는다 — 두 방향이 나란히 놓인 메뉴에서 누른 쪽과 반대로 정렬되면
 * 그 메뉴는 거짓말이 된다.
 */
export function buildSortDirHref(params: ParsedListParams, key: SortKey, dir: SortDir): string {
  return hrefWith(params, { sort: key, dir, page: "1" });
}

/** 지금 이 열로 정렬 중인가 — 머리글의 화살표 방향을 정한다. */
export function sortStateOf(params: ParsedListParams, key: SortKey): SortDir | null {
  const current = params.sort ?? DEFAULT_SORT;
  return current === key ? (params.dir ?? DEFAULT_DIR) : null;
}
