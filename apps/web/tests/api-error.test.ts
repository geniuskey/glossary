import { expect, test } from "vitest";
import { apiError, methodNotAllowed } from "../src/lib/api-error.js";
import { GET as unmatchedGet, POST as unmatchedPost } from "../src/app/api/v1/[...unmatched]/route.js";
import { GET as loginGet } from "../src/app/api/v1/auth/login/route.js";
import { GET as logoutGet } from "../src/app/api/v1/auth/logout/route.js";
import { POST as healthPost } from "../src/app/api/v1/health/route.js";
import { PUT as keysPut } from "../src/app/api/v1/keys/route.js";
import { GET as keyIdGet } from "../src/app/api/v1/keys/[id]/route.js";

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

// R29(e)(Task 6 잔여): Allow가 "존재만 하면 통과"가 아니라 라우트별 실제 허용
// 메서드와 정확히 일치하는지 확인한다. methodStubs가 만드는 OPTIONS도 같은
// 값을 광고해야 하므로(R29(a)) 여기서 함께 검증한다.
test("지원하지 않는 메서드로 실제 라우트를 호출해도 JSON 에러 규약과 정확한 Allow 헤더를 지킨다", async () => {
  const cases: Array<[() => Response | Promise<Response>, string]> = [
    [loginGet, "POST"],
    [logoutGet, "POST"],
    [healthPost, "GET"],
    [keysPut, "GET, POST"],
    [keyIdGet, "DELETE"],
  ];

  for (const [handler, allow] of cases) {
    const res = await handler();
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("allow")).toBe(allow);
    await expect(res.json()).resolves.toEqual({
      error: { code: "method_not_allowed", message: "지원하지 않는 메서드입니다." },
    });
  }
});

test("methodStubs가 만드는 OPTIONS는 204와 함께 실제 허용 메서드만 정확히 광고한다", async () => {
  const { OPTIONS: loginOptions } = await import("../src/app/api/v1/auth/login/route.js");
  const { OPTIONS: healthOptions } = await import("../src/app/api/v1/health/route.js");
  const { OPTIONS: keysOptions } = await import("../src/app/api/v1/keys/route.js");
  const { OPTIONS: keyIdOptions } = await import("../src/app/api/v1/keys/[id]/route.js");

  const cases: Array<[() => Response, string]> = [
    [loginOptions, "POST"],
    [healthOptions, "GET"],
    [keysOptions, "GET, POST"],
    [keyIdOptions, "DELETE"],
  ];

  for (const [handler, allow] of cases) {
    const res = handler();
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toBe(allow);
  }
});
