import { termStatusEnum, termTypeEnum } from "@grossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { termInputSchema } from "@/lib/terms/schema";
import { createTerm } from "@/lib/terms/create";
import { listTerms, type TermStatus, type TermType } from "@/lib/terms/query";

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
 */
function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): T | undefined | Response {
  if (raw === null) return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  return apiError(
    "validation_failed",
    `${field} 값이 올바르지 않습니다: ${raw}`,
    400,
    { field, allowed },
  );
}

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const url = new URL(request.url);

  const termType = parseEnumParam<TermType>(url.searchParams.get("type"), termTypeEnum.enumValues, "type");
  if (isResponse(termType)) return termType;

  const status = parseEnumParam<TermStatus>(url.searchParams.get("status"), termStatusEnum.enumValues, "status");
  if (isResponse(status)) return status;

  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  const result = await listTerms({
    q: url.searchParams.get("q") ?? undefined,
    termType,
    domain: url.searchParams.get("domain") ?? undefined,
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

  const authorId = auth.kind === "user" ? auth.user.id : null;
  // R47: API 키로 인증된 요청은 authorId가 항상 null이라, 리비전에 누가 썼는지
  // 남기려면 authorKeyId를 별도로 넘겨야 한다.
  const authorKeyId = auth.kind === "key" ? auth.keyId : null;
  const { term, surfaces, warnings } = await createTerm(parsed.data, authorId, authorKeyId);

  return Response.json({ term, surfaces, warnings }, { status: 201 });
});
