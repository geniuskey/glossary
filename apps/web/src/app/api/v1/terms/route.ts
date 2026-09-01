import { termStatusEnum, termTypeEnum } from "@grossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { termInputSchema } from "@/lib/terms/schema";
import { createTerm } from "@/lib/terms/create";
import { DOMAIN_VALUE_MAX, TERM_QUERY_MAX } from "@/lib/terms/limits";
import { isAssignableUserId } from "@/lib/terms/owners";
import { businessCategoryExists } from "@/lib/terms/categories";
import { listTerms, type BusinessCategory, type TermStatus, type TermType } from "@/lib/terms/query";
import { toSurfaceWire, toTermWire, toWarningWire, type TermWriteResponse } from "@/lib/terms/wire";

// R25: 새 라우트도 처리하지 않는 메서드를 명시 export한다.
const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

/**
 * R41: `?type=`/`?status=`는 클라이언트가 자유 텍스트로 채우는 값이라, 알려진
 * union 밖의 값이 얼마든지 들어올 수 있다. listTerms가 그 값을 그대로 Postgres
 * enum 비교에 넘기면(`as never`로 타입만 속이고) DB가 예외를 던지고
 * withApiErrors가 500 internal_error로 바꾼다 — 그런데 이 입력은 재시도해도
 * 절대 성공하지 않는 영구적으로 잘못된 입력이라, 기계 클라이언트에게 "나중에
 * 다시 시도하라"는 5xx 신호를 주면 안 된다. 여기서 먼저 걸러 400
 * validation_failed로 답한다.
 *
 * R64: `?type=`처럼 파라미터가 "존재하지만 값이 빈 문자열"인 경우는 위의
 * "알 수 없는 값" 케이스와 다르다 — `<select>`를 아무것도 고르지 않은 채
 * 폼을 querystring으로 직렬화하면 대부분의 헬퍼가 `type=`을 만들어 낸다.
 * `?q=`/`?domain=`은 이미 listTerms에서 빈 문자열이 falsy로 걸러지므로
 * 조용히 무시되는데, type/status만 다른 규칙(400)을 적용하면 같은 querystring
 * 안에서 파라미터마다 규칙이 갈리는 셈이다 — null과 마찬가지로 "지정 안 함"으로
 * 취급한다.
 */
function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): T | undefined | Response {
  if (raw === null || raw === "") return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  return apiError(
    "validation_failed",
    `${field} 값이 올바르지 않습니다: ${raw}`,
    400,
    { field, allowed },
  );
}

const LEGACY_TYPE_QUERY: Record<string, TermType> = {
  term: "concept",
  abbreviation: "concept",
  project: "proper_name",
  product_id: "identifier",
  code: "identifier",
  unit: "unit",
};

/**
 * R59: `Number("1e999")`는 `Infinity`다 — 그 값이 그대로 `.offset()`까지
 * 흘러가면 Postgres가 예외를 던지고 withApiErrors가 500으로 바꾼다. 이 입력도
 * type/status와 마찬가지로 재시도해도 절대 성공하지 않는 영구적으로 잘못된
 * 입력이므로 500이 아니라 400 validation_failed여야 한다(R41과 같은 이유).
 * 유한하지 않은 값은 여기서 막고, 소수는 내림해서 정수로 정규화한 뒤 min/max로
 * 클램프한다.
 *
 * R65: 빈 문자열(`?page=`)과 형식이 잘못된 값(`?page=abc`)은 서로 다른 것이다
 * — 빈 값은 "지정 안 함"(R64와 같은 규칙, 기본값을 쓴다)이고, 형식이 잘못된
 * 값은 "잘못 지정함"(재시도해도 절대 성공하지 않으므로 400)이다. 이 둘을
 * 섞으면(둘 다 기본값으로 조용히 넘기면) 클라이언트의 타이핑 실수가 영원히
 * 숨겨진다.
 */
function parsePageParam(
  raw: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number | Response {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return apiError("validation_failed", `${field} 값이 올바르지 않습니다: ${raw}`, 400, { field });
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const url = new URL(request.url);

  const q = url.searchParams.get("q");
  const domain = url.searchParams.get("domain");
  const rawCategory = url.searchParams.get("category");
  const categoryIsKnown = rawCategory ? await businessCategoryExists(rawCategory) : false;
  const topic = url.searchParams.get("topic") ?? (rawCategory && !categoryIsKnown ? rawCategory : null);
  if (q && q.length > TERM_QUERY_MAX) {
    return apiError("validation_failed", `q는 ${TERM_QUERY_MAX}자 이하여야 합니다.`, 400, { field: "q" });
  }
  if (domain && domain.length > DOMAIN_VALUE_MAX) {
    return apiError("validation_failed", `domain은 ${DOMAIN_VALUE_MAX}자 이하여야 합니다.`, 400, { field: "domain" });
  }
  if (rawCategory && rawCategory.length > DOMAIN_VALUE_MAX) {
    return apiError("validation_failed", `category는 ${DOMAIN_VALUE_MAX}자 이하여야 합니다.`, 400, { field: "category" });
  }
  if (topic && topic.length > DOMAIN_VALUE_MAX) {
    return apiError("validation_failed", `topic은 ${DOMAIN_VALUE_MAX}자 이하여야 합니다.`, 400, { field: "topic" });
  }

  const rawType = url.searchParams.get("type");
  const termType = parseEnumParam<TermType>(rawType ? LEGACY_TYPE_QUERY[rawType] ?? rawType : rawType, termTypeEnum.enumValues, "type");
  if (isResponse(termType)) return termType;

  const category: BusinessCategory | undefined = rawCategory && categoryIsKnown ? rawCategory : undefined;

  const status = parseEnumParam<TermStatus>(url.searchParams.get("status"), termStatusEnum.enumValues, "status");
  if (isResponse(status)) return status;

  const page = parsePageParam(url.searchParams.get("page"), "page", 1, 1, Number.MAX_SAFE_INTEGER);
  if (isResponse(page)) return page;

  const pageSize = parsePageParam(url.searchParams.get("pageSize"), "pageSize", 20, 1, 100);
  if (isResponse(pageSize)) return pageSize;

  const result = await listTerms({
    q: q ?? undefined,
    termType,
    domain: domain ?? undefined,
    category: category ?? undefined,
    topic: topic ?? undefined,
    status,
    page,
    pageSize,
  });

  return Response.json({ ...result, page, pageSize });
});

// 중복이 있어도 409를 던지지 않는다. 동음이의어를 허용하기로 했으므로 저장은
// 진행하고 warnings로만 알린다.
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const parsed = termInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "용어 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
  }
  if (parsed.data.ownerId && !(await isAssignableUserId(parsed.data.ownerId))) {
    return apiError("validation_failed", "담당자 계정을 찾을 수 없습니다.", 400, { field: "ownerId" });
  }
  if (parsed.data.category && !(await businessCategoryExists(parsed.data.category))) {
    return apiError("validation_failed", "업무 분류를 찾을 수 없습니다.", 400, { field: "category" });
  }

  const authorId = auth.kind === "user" ? auth.user.id : null;
  // R47: API 키로 인증된 요청은 authorId가 항상 null이라, 리비전에 누가 썼는지
  // 남기려면 authorKeyId를 별도로 넘겨야 한다.
  const authorKeyId = auth.kind === "key" ? auth.keyId : null;
  const { term, surfaces, warnings } = await createTerm(parsed.data, authorId, authorKeyId);

  // R112: createTerm이 돌려주는 term/surfaces는 DB 원시 행이다 — 명시 wire
  // 타입으로 변환해 createdBy/updatedBy/normLoose 같은 내부 컬럼이 새지 않게
  // 한다. PATCH(아래 [idOrSlug]/route.ts)도 정확히 같은 타입을 쓴다.
  const body: TermWriteResponse = {
    term: toTermWire(term),
    surfaces: surfaces.map(toSurfaceWire),
    warnings: warnings.map(toWarningWire),
  };
  return Response.json(body, { status: 201 });
});
