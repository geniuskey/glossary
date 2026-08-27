import { termStatusEnum, termTypeEnum } from "@grossary/db";
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
export function parsePage(raw: string | string[] | undefined): number {
  const value = firstValue(raw);
  if (value === undefined) return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

export function parseListParams(raw: RawSearchParams): ParsedListParams {
  return {
    q: firstValue(raw.q),
    type: narrowEnum(raw.type, termTypeEnum.enumValues),
    domain: firstValue(raw.domain),
    status: narrowEnum(raw.status, termStatusEnum.enumValues),
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
export function hiddenSearchFields(params: ParsedListParams): Array<{ name: FilterName; value: string }> {
  return activeFilters(params).filter((f) => f.name !== "q");
}

// R93: 페이지네이션 링크. 현재 활성 필터를 전부 보존하면서 page만 targetPage로
// 바꾼다.
export function buildPageHref(params: ParsedListParams, targetPage: number): string {
  const usp = new URLSearchParams();
  for (const f of activeFilters(params)) usp.set(f.name, f.value);
  usp.set("page", String(targetPage));
  return `/terms?${usp.toString()}`;
}
