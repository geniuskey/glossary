export type ApiErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "term_not_found"
  | "revision_conflict"
  // R131: 가입에서만 쓴다. 로그인과 달리 계정 존재 여부를 숨기지 않는다 —
  // 가입 화면이 이유를 말해주지 않으면 같은 이메일로 계속 다시 시도하게 된다.
  | "email_taken"
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
  // R37: Next는 GET이 있으면 HEAD를 자동으로 파생시켜 200으로 응답하지만, Allow에는
  // 광고하지 않는다 — "서버가 기계 클라이언트에게 Allow로 거짓말하지 않는다"는
  // R29(a)와 같은 종류의 문제다. GET을 허용하는 라우트는 항상 HEAD도 함께 광고한다
  // (HEAD는 GET 바로 뒤에 둔다 — GET에서 파생된 메서드라는 관계를 그대로 보여준다).
  const allowList: string[] = [];
  for (const method of allowed) {
    allowList.push(method);
    if (method === "GET" && !allowed.includes("HEAD")) allowList.push("HEAD");
  }
  const stub: RouteHandler = () => methodNotAllowed(allowList);
  const options: RouteHandler = () => new Response(null, { status: 204, headers: { allow: allowList.join(", ") } });

  return { GET: stub, POST: stub, PUT: stub, PATCH: stub, DELETE: stub, OPTIONS: options };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R42: UUID 형식 판별은 이 모듈이 유일하게 소유한다. query.ts 등 다른 곳에서
 * 같은 정규식을 다시 정의하지 말고 이 함수를 가져다 쓴다 — 두 곳의 정규식이
 * 조용히 갈라지는 것을 막는다.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * R38: `[id]` 라우트가 DB에 묻기 전에 id 형식을 검증하는 공용 가드.
 *
 * 형식이 잘못된 id를 그대로 쿼리에 넘기면 Postgres가
 * "invalid input syntax for type uuid"를 던지고, withApiErrors가 이를 500
 * internal_error로 바꾼다 — 틀린 응답은 아니다(실측: SQL 인젝션·XSS 페이로드를
 * 포함해 어떤 형태의 잘못된 id를 넣어도 유출이나 인젝션 없이 안전하게 500으로
 * 막힌다). 그래도 두 가지 이유로 여기서 미리 거른다.
 *
 * 1. 5xx는 재시도하는 기계 클라이언트에게 "나중에 다시 시도하라"는 신호다. 하지만
 *    형식이 잘못된 id는 재시도해도 절대 성공하지 않는 영구적으로 잘못된 입력이다.
 *    404는 정확한 신호를 준다.
 * 2. id가 존재하지 않는 경우와 똑같이 404 not_found로 답하므로, 형식 검증
 *    유무만으로 "그 id가 실제로 존재하는지"를 구분할 수 있는 정보도 새지 않는다.
 *
 * Task 9/10의 `/terms/[id]`처럼 앞으로 나올 `[id]` 라우트도 이 헬퍼를 재사용한다
 * — 라우트마다 이 판단을 매번 다시 내리지 않도록.
 */
export function requireUuid(value: string, notFoundMessage: string): string | Response {
  if (!UUID_RE.test(value)) return apiError("not_found", notFoundMessage, 404);
  return value;
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
