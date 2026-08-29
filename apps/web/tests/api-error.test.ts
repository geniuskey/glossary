import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { apiError, methodNotAllowed, withApiErrors } from "../src/lib/api-error.js";
import { GET as unmatchedGet, POST as unmatchedPost } from "../src/app/api/v1/[...unmatched]/route.js";
import * as loginRoute from "../src/app/api/v1/auth/login/route.js";
import * as logoutRoute from "../src/app/api/v1/auth/logout/route.js";
import * as registerRoute from "../src/app/api/v1/auth/register/route.js";
import * as healthRoute from "../src/app/api/v1/health/route.js";
import * as keysRoute from "../src/app/api/v1/keys/route.js";
import * as keyIdRoute from "../src/app/api/v1/keys/[id]/route.js";
import * as termsRoute from "../src/app/api/v1/terms/route.js";
import * as termLookupRoute from "../src/app/api/v1/terms/lookup/route.js";
import * as termSuggestRoute from "../src/app/api/v1/terms/suggest/route.js";
import * as termIdOrSlugRoute from "../src/app/api/v1/terms/[idOrSlug]/route.js";
import * as termRevisionsRoute from "../src/app/api/v1/terms/[idOrSlug]/revisions/route.js";
import * as openapiRoute from "../src/app/api/v1/openapi/route.js";
import * as importRoute from "../src/app/api/v1/import/route.js";
import * as setupRoute from "../src/app/api/v1/setup/route.js";
import * as termRevertRoute from "../src/app/api/v1/terms/[idOrSlug]/revisions/[number]/revert/route.js";
import * as ssoRoute from "../src/app/api/v1/sso/route.js";
import * as ssoDiscoverRoute from "../src/app/api/v1/sso/discover/route.js";

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
  { name: "auth/login", mod: loginRoute, allowed: ["POST"], allow: "POST" },
  { name: "auth/logout", mod: logoutRoute, allowed: ["POST"], allow: "POST" },
  { name: "auth/register", mod: registerRoute, allowed: ["POST"], allow: "POST" },
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
  // R136: 자동완성 라우트는 GET만 처리한다.
  { name: "terms/suggest", mod: termSuggestRoute, allowed: ["GET"], allow: "GET, HEAD" },
  // Task 10: terms/[idOrSlug] 라우트는 이제 GET/PATCH/DELETE를 처리한다. 이 행을
  // 갱신하지 않으면 새로 추가된 PATCH/DELETE의 405 스텁 누락이나 Allow 헤더
  // 불일치를 아무 테스트도 못 잡는다.
  { name: "terms/[idOrSlug]", mod: termIdOrSlugRoute, allowed: ["GET", "PATCH", "DELETE"], allow: "GET, HEAD, PATCH, DELETE" },
  // Task 10: 리비전 이력 라우트는 GET만 처리한다. 이 행이 없으면 POST/PUT/
  // PATCH/DELETE 스텁이 통째로 빠져도 아무 테스트도 못 잡는다.
  { name: "terms/[idOrSlug]/revisions", mod: termRevisionsRoute, allowed: ["GET"], allow: "GET, HEAD" },
  // Task 15: 스펙 라우트. GET만 처리한다.
  { name: "openapi", mod: openapiRoute, allowed: ["GET"], allow: "GET, HEAD" },
  // Task 14(R118): import 라우트는 POST만 처리한다. 이 행이 없으면 이
  // 저장소에서 다섯 번째로 반복된 405 스텁 누락(R83이 네 번째)이 아무 테스트도
  // 못 잡는 채로 남는다.
  { name: "import", mod: importRoute, allowed: ["POST"], allow: "POST" },
  // R130: 아래 파일시스템 대조 테스트가 처음 돌자마자 잡아낸 누락 — setup 라우트는
  // 만들어진 이래 405 스위프를 한 번도 받지 않았다. 표를 손으로만 유지하면 이렇게 된다.
  { name: "setup", mod: setupRoute, allowed: ["POST"], allow: "POST" },
  // R130: 되돌리기 라우트는 POST만 처리한다. 이 표가 손으로 유지되는 바람에 라우트를
  // 추가하고 여기를 빼먹는 실수가 다섯 번 반복됐다(R83, R118 …). 아래 "라우트 디렉터리와
  // 이 표가 어긋나지 않는다" 테스트가 이제 그 반복을 막는다.
  {
    name: "terms/[idOrSlug]/revisions/[number]/revert",
    mod: termRevertRoute,
    allowed: ["POST"],
    allow: "POST",
  },
  // R132: SSO 설정 라우트. 브라우저가 오가는 /auth/sso/*는 JSON을 내지 않는
  // 302 전용이라 이 표(= /api/v1 규약)의 대상이 아니다.
  { name: "sso", mod: ssoRoute, allowed: ["GET", "PUT"], allow: "GET, HEAD, PUT" },
  { name: "sso/discover", mod: ssoDiscoverRoute, allowed: ["POST"], allow: "POST" },
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

// R130: 위 ROUTES 표는 손으로 유지된다 — 라우트를 추가하고 이 표에 넣지 않으면
// 405 스텁이 통째로 빠져도 스위프가 그 라우트를 아예 돌지 않아 전부 그린이다.
// 실제로 이 저장소에서만 다섯 번 반복된 실수라(C1, R44, R83, R58, R118), 표
// 자체를 파일시스템과 대조해 잠근다. openapi.test.ts가 스펙에 대해 하는 일과
// 같은 패턴이다.
const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "api", "v1");

// 캐치올은 "매칭되지 않은 모든 경로"를 404로 만드는 장치라 ALLOWED_METHODS도
// 405 스텁도 없다(openapi.test.ts의 SPEC_EXEMPT와 같은 이유).
const SWEEP_EXEMPT = new Set(["[...unmatched]"]);

function collectRouteFiles(dir: string, segments: string[] = [], acc: Array<{ name: string; methods: string[] }> = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(full, [...segments, entry.name], acc);
    } else if (entry.name === "route.ts") {
      const src = readFileSync(full, "utf8");
      const match = /const ALLOWED_METHODS = \[([^\]]*)\]/.exec(src);
      acc.push({
        name: segments.join("/"),
        methods: match ? [...match[1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!) : [],
      });
    }
  }
  return acc;
}

const routeFiles = collectRouteFiles(apiRoot).filter((r) => !SWEEP_EXEMPT.has(r.name));

test("R130: app/api/v1/ 밑의 모든 라우트가 405 스위프 표에 들어 있다", () => {
  // vacuity 가드 — 수집이 통째로 실패하면 루프가 그냥 통과한다.
  expect(routeFiles.length).toBeGreaterThanOrEqual(12);
  const listed = new Set(ROUTES.map((r) => r.name));

  for (const route of routeFiles) {
    expect(listed.has(route.name), `${route.name}: ROUTES 표에 없다`).toBe(true);
  }
  for (const name of listed) {
    expect(
      routeFiles.some((r) => r.name === name),
      `${name}: 표에는 있는데 라우트 파일이 없다`,
    ).toBe(true);
  }
});

// 표의 allowed가 라우트의 실제 ALLOWED_METHODS보다 넓으면, 그 메서드는 스위프에서
// `continue`로 건너뛰어져 405 검증이 조용히 사라진다.
test("R130: 표의 allowed가 각 라우트의 ALLOWED_METHODS와 정확히 일치한다", () => {
  for (const route of routeFiles) {
    const entry = ROUTES.find((r) => r.name === route.name);
    expect([...(entry?.allowed ?? [])].sort(), `${route.name}: allowed 불일치`).toEqual(
      [...route.methods].sort(),
    );
  }
});
