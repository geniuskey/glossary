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

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type StubbedMethod = (typeof HTTP_METHODS)[number];
type RouteHandler = () => Response;

/**
 * R29(a): 라우트마다 손으로 4~5개씩 반복하던 405 스텁을 여기서 한 번에 만든다.
 *
 * 손으로 스텁을 export하면 Next의 자동 OPTIONS가 "이 이름으로 export된 함수가
 * 있으니 이 메서드는 지원된다"고 가정해, 405만 내는 메서드까지 Allow에 광고한다
 * (Task 6 리뷰에서 실측: Allow: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT을
 * 광고하면서 정작 그 메서드들은 Allow: POST인 405를 반환 — 기계 클라이언트에게
 * 거짓말을 하는 셈). 이 헬퍼가 만드는 OPTIONS export가 Next의 자동 생성을
 * 덮어써서, Allow 헤더가 실제 허용 메서드와 항상 일치하게 한다.
 *
 * 라우트 파일에서는 실제로 구현하는 메서드는 제외하고 나머지만 구조분해해
 * export한다. 실수로 실제 핸들러의 이름까지 함께 구조분해하면, 그 아래의 진짜
 * `export const GET = ...` 등과 이름이 겹쳐 중복 선언 오류로 즉시 드러난다.
 *
 * 사용례:
 *   const ALLOWED_METHODS = ["POST"];
 *   const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
 *   export { GET, PUT, PATCH, DELETE, OPTIONS };
 *   export const POST = withApiErrors(async (request: Request) => { ... });
 */
export function methodStubs(allowed: readonly string[]): Record<StubbedMethod, RouteHandler> & { OPTIONS: RouteHandler } {
  const allowList = [...allowed];
  const stub: RouteHandler = () => methodNotAllowed(allowList);
  const options: RouteHandler = () => new Response(null, { status: 204, headers: { allow: allowList.join(", ") } });

  return { GET: stub, POST: stub, PUT: stub, PATCH: stub, DELETE: stub, OPTIONS: options };
}

/**
 * R28: 라우트 핸들러가 던진 예외를 본문 있는 JSON 500으로 바꾼다.
 *
 * Next 라우트 핸들러에서 던진 예외는 본문 없는 500이 되어 "모든 API 에러는
 * { error: { code, message } } 규약을 따른다. 예외 없음"을 깬다. api_keys.prefix의
 * 유니크 인덱스 충돌(23505)이나 DB 연결 장애처럼 흔치 않지만 가능한 예외까지
 * 규약 안에 들어오게 하려는 안전망이다.
 *
 * 원인은 서버 로그에만 남기고, 응답 본문에는 예외 메시지나 스택을 노출하지 않는다.
 */
export function withApiErrors<A extends unknown[]>(
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(err);
      return apiError("internal_error", "서버 오류가 발생했습니다.", 500);
    }
  };
}
