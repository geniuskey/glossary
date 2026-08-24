import { expect, test } from "vitest";
import { apiError } from "../src/lib/api-error.js";
import { GET as unmatchedGet, POST as unmatchedPost } from "../src/app/api/v1/[...unmatched]/route.js";

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
