export type ApiErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "term_not_found"
  | "revision_conflict"
  | "payload_too_large"
  | "method_not_allowed"
  | "internal_error";

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  return Response.json({ error: details === undefined ? { code, message } : { code, message, details } }, { status });
}

/**
 * Next가 라우트에 없는 HTTP 메서드에 기본 제공하는 405는 본문이 0바이트고
 * content-type도 없다 — "모든 API 에러는 JSON 규약을 따른다. 예외 없음"을 깬다.
 * 각 라우트는 자신이 처리하지 않는 메서드를 이 헬퍼로 명시 export해야 한다.
 */
export function methodNotAllowed(allow: string[]): Response {
  const res = apiError("method_not_allowed", "지원하지 않는 메서드입니다.", 405);
  res.headers.set("allow", allow.join(", "));
  return res;
}
