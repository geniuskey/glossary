import { expect, test } from "vitest";
import { apiError, methodNotAllowed, withApiErrors } from "../src/lib/api-error.js";
import { GET as unmatchedGet, POST as unmatchedPost } from "../src/app/api/v1/[...unmatched]/route.js";
import * as loginRoute from "../src/app/api/v1/auth/login/route.js";
import * as logoutRoute from "../src/app/api/v1/auth/logout/route.js";
import * as healthRoute from "../src/app/api/v1/health/route.js";
import * as keysRoute from "../src/app/api/v1/keys/route.js";
import * as keyIdRoute from "../src/app/api/v1/keys/[id]/route.js";
import * as termsRoute from "../src/app/api/v1/terms/route.js";
import * as termLookupRoute from "../src/app/api/v1/terms/lookup/route.js";
import * as termIdOrSlugRoute from "../src/app/api/v1/terms/[idOrSlug]/route.js";
import * as termRevisionsRoute from "../src/app/api/v1/terms/[idOrSlug]/revisions/route.js";
import * as importRoute from "../src/app/api/v1/import/route.js";

// 라우트 모듈은 실제 핸들러(GET/POST/...)마다 서로 다른 인자 개수를 요구하므로
// (예: DELETE는 (request, context)) 여기서는 이름으로 임의 접근한 뒤 405 스텁/
// OPTIONS를 인자 없이 호출할 때만 명목상 함수 타입으로 좁힌다.
type RouteHandler = () => Response | Promise<Response>;
type RouteModule = Record<string, unknown>;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// R35(d)/R37: 라우트별로 실제로 허용하는 메서드와, HEAD까지 포함해 Allow에 정확히
// 실려야 하는 값. 라우트마다 미지원 메서드 중 하나만 대표로 찍어 확인하면
// (예: keys/route.ts에서 PUT만 확인) 나머지 미지원 메서드(PATCH, DELETE)의 405
// 스텁이 통째로 빠져도 못 잡는다(실측: PATCH export를 지우면 Next의 0바이트/
// 헤더 없는 기본 405가 나오는데 vitest도 tsc도 잡지 못했다). 그래서 라우트마다
// "허용되지 않은 모든 메서드"를 순회한다.
const ROUTES: Array<{ name: string; mod: RouteModule; allowed: readonly string[]; allow: string }> = [
  { name: "login", mod: loginRoute, allowed: ["POST"], allow: "POST" },
  { name: "logout", mod: logoutRoute, allowed: ["POST"], allow: "POST" },
  { name: "health", mod: healthRoute, allowed: ["GET"], allow: "GET, HEAD" },
  { name: "keys", mod: keysRoute, allowed: ["GET", "POST"], allow: "GET, HEAD, POST" },
  { name: "keys/[id]", mod: keyIdRoute, allowed: ["DELETE"], allow: "DELETE" },
  // C1(리뷰): 이 행이 없으면 terms/route.ts에서 PATCH/DELETE 스텁 export가
  // 통째로 빠져도(예: methodStubs 목록에서 실수로 지워짐) 57개 테스트가 전부
  // 그린으로 남는다 — 실측된 회귀.
  // R44: Task 9가 GET을 추가하면서 ALLOWED_METHODS도 ["GET", "POST"]로
  // 바뀌었다. 여기를 갱신하지 않으면 이 표는 여전히 옛 계약("POST"만 허용)을
  // 검증해 GET 405 스텁이 사라져도 이 스위프는 못 잡는다.
  { name: "terms", mod: termsRoute, allowed: ["GET", "POST"], allow: "GET, HEAD, POST" },
  // Task 11(R83): terms/lookup은 POST만 처리하는 정적 라우트다. 이 행이 없으면
  // GET/PUT/PATCH/DELETE의 405 스텁 누락을 아무 테스트도 못 잡는다 — 이 구멍이
  // 이 저장소에서 네 번째로 반복되는 실수였다(Task 8 P7, Task 9 R58, Task 10 F1).
  { name: "terms/lookup", mod: termLookupRoute, allowed: ["POST"], allow: "POST" },
  // Task 10: terms/[idOrSlug] 라우트는 이제 GET/PATCH/DELETE를 처리한다. 이 행을
  // 갱신하지 않으면 새로 추가된 PATCH/DELETE의 405 스텁 누락이나 Allow 헤더
  // 불일치를 아무 테스트도 못 잡는다.
  { name: "terms/[idOrSlug]", mod: termIdOrSlugRoute, allowed: ["GET", "PATCH", "DELETE"], allow: "GET, HEAD, PATCH, DELETE" },
  // Task 10: 리비전 이력 라우트는 GET만 처리한다. 이 행이 없으면 POST/PUT/
  // PATCH/DELETE 스텁이 통째로 빠져도 아무 테스트도 못 잡는다.
  { name: "terms/[idOrSlug]/revisions", mod: termRevisionsRoute, allowed: ["GET"], allow: "GET, HEAD" },
  // Task 14(R118): import 라우트는 POST만 처리한다. 이 행이 없으면 이
  // 저장소에서 다섯 번째로 반복된 405 스텁 누락(R83이 네 번째)이 아무 테스트도
  // 못 잡는 채로 남는다.
  { name: "import", mod: importRoute, allowed: ["POST"], allow: "POST" },
];

test("에러 응답이 규약 형태를 지킨다", async () => {
  const res = apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  await expect(res.json()).resolves.toEqual({
    error: { code: "term_not_found", message: "용어를 찾을 수 없습니다." },
  });
});

test("details가 있으면 함께 실린다", async () => {
  const res = apiError("validation_failed", "요청이 올바르지 않습니다.", 400, { field: "slug" });
  await expect(res.json()).resolves.toEqual({
    error: { code: "validation_failed", message: "요청이 올바르지 않습니다.", details: { field: "slug" } },
  });
});

test("매칭되지 않는 API 경로도 JSON 에러 규약을 지킨다", async () => {
  for (const handler of [unmatchedGet, unmatchedPost]) {
    const res = handler();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({
      error: { code: "not_found", message: "요청한 경로를 찾을 수 없습니다." },
    });
  }
});

// F5(리뷰): Next가 기본 제공하는 405는 본문 0바이트/content-type 없음이라
// "모든 API 에러는 JSON 규약을 따른다. 예외 없음"을 깬다. methodNotAllowed가
// 이를 막고, Allow 헤더도 정확히 실리는지 확인한다.
test("methodNotAllowed가 405와 JSON 에러 규약, Allow 헤더를 함께 반환한다", async () => {
  const res = methodNotAllowed(["POST"]);
  expect(res.status).toBe(405);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(res.headers.get("allow")).toBe("POST");
  await expect(res.json()).resolves.toEqual({
    error: { code: "method_not_allowed", message: "지원하지 않는 메서드입니다." },
  });
});

// R29(e)/R35(d): Allow가 "존재만 하면 통과"가 아니라 라우트별 실제 허용 메서드와
// 정확히 일치하는지, 그것도 미지원 메서드 전부에서 확인한다.
test("지원하지 않는 모든 메서드로 실제 라우트를 호출해도 JSON 에러 규약과 정확한 Allow 헤더를 지킨다", async () => {
  for (const { name, mod, allowed, allow } of ROUTES) {
    for (const method of HTTP_METHODS) {
      if (allowed.includes(method)) continue;
      const handler = mod[method];
      expect(handler, `${name} ${method} export가 없다`).toBeTypeOf("function");

      const res = await (handler as RouteHandler)();
      expect(res.status, `${name} ${method}`).toBe(405);
      expect(res.headers.get("content-type"), `${name} ${method}`).toContain("application/json");
      expect(res.headers.get("allow"), `${name} ${method}`).toBe(allow);
      await expect(res.json(), `${name} ${method}`).resolves.toEqual({
        error: { code: "method_not_allowed", message: "지원하지 않는 메서드입니다." },
      });
    }
  }
});

// R37: methodStubs가 만드는 OPTIONS도 405 스텁과 같은 Allow 값을 광고해야 한다
// (R29(a)). GET을 허용하는 라우트는 Next가 자동으로 파생시키는 HEAD도 함께 실린다.
test("methodStubs가 만드는 OPTIONS는 204와 함께 실제 허용 메서드(HEAD 포함)만 정확히 광고한다", async () => {
  for (const { name, mod, allow } of ROUTES) {
    const res = await (mod.OPTIONS as RouteHandler)();
    expect(res.status, name).toBe(204);
    expect(res.headers.get("allow"), name).toBe(allow);
  }
});

// R35(c): withApiErrors가 없으면(과거 스타일) 라우트 핸들러가 던진 예외가 본문 없는
// 500이 되어 JSON 규약을 깬다. 응답 본문에 예외 메시지나 스택이 새지 않는지도 함께 확인한다.
test("withApiErrors는 던져진 예외를 500 internal_error로 바꾸고 메시지·스택을 응답에 노출하지 않는다", async () => {
  const err = new Error("DB_PASSWORD=hunter2 (config at /secret/internal/path.ts:42)");
  const handler = withApiErrors(async () => {
    throw err;
  });

  const res = await handler();
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");

  const body = await res.json();
  expect(body).toEqual({ error: { code: "internal_error", message: "서버 오류가 발생했습니다." } });

  const raw = JSON.stringify(body);
  expect(raw).not.toContain(err.message);
  expect(raw).not.toContain("hunter2");
  if (err.stack) expect(raw).not.toContain(err.stack.split("\n")[0]!);
});

// R35(c): try/catch 자체가 통째로 빠지는 회귀. 위 테스트는 그 경우 await가 그대로
// reject해 실패하지만, 무엇을 보장하는지 이름으로 분명히 드러나는 전용 테스트를 둔다.
test("withApiErrors로 감싼 핸들러는 예외를 던져도 reject하지 않고 항상 Response로 resolve한다", async () => {
  const handler = withApiErrors(async () => {
    throw new Error("boom");
  });
  await expect(handler()).resolves.toBeInstanceOf(Response);
});
