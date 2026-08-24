export type ApiErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "term_not_found"
  | "revision_conflict"
  | "payload_too_large"
  | "internal_error";

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  return Response.json({ error: details === undefined ? { code, message } : { code, message, details } }, { status });
}
