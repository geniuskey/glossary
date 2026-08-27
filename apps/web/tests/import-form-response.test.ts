import { expect, test } from "vitest";
import { forceEligibleRowNumbers, interpretImportResponse } from "../src/lib/import/form-response.js";

// R121: 계획서 스케치는 fetch 응답을 res.ok 확인 없이 곧장 성공으로 가정했다.
// 이 테스트들은 그 회귀를 정확히 잡는다 — ok:false인데 성공 바디처럼 생긴
// body를 줘도(또는 그 반대) interpretImportResponse가 절대 성공으로 잘못
// 판정하지 않아야 한다.

test("R121: ok=false면 report/created가 있어도 항상 error로 판정한다", () => {
  const outcome = interpretImportResponse(false, { report: { total: 1, ready: 1 } }, true);
  expect(outcome.kind).toBe("error");
});

test("R121: 401 등 오류 응답의 error.message를 그대로 사용자에게 보여준다", () => {
  const outcome = interpretImportResponse(false, { error: { code: "unauthorized", message: "로그인이 필요합니다." } }, true);
  expect(outcome).toEqual({ kind: "error", message: "로그인이 필요합니다." });
});

test("바디가 JSON 파싱에 실패해 null이면(오류 응답) 안전한 기본 메시지로 떨어진다", () => {
  const outcome = interpretImportResponse(false, null, true);
  expect(outcome.kind).toBe("error");
  expect(typeof (outcome as { message: string }).message).toBe("string");
});

test("dry-run 성공 응답은 report를 그대로 담아 dryRunSuccess로 판정한다", () => {
  const report = {
    total: 3,
    ready: 1,
    conflicts: [{ rowNumber: 2, name: "AE", conflictingSlugs: ["ae"] }],
    duplicatesInFile: [{ key: "gain", rowNumbers: [3, 4] }],
    errors: [],
    fileErrors: [],
    ignoredHeaders: [],
  };
  const outcome = interpretImportResponse(true, { dryRun: true, report }, true);
  expect(outcome).toEqual({ kind: "dryRunSuccess", report });
});

test("dry-run인데 report 모양이 아니면 성공 바디라도 error로 떨어진다", () => {
  const outcome = interpretImportResponse(true, { dryRun: true }, true);
  expect(outcome.kind).toBe("error");
});

test("반영 성공 응답은 created/skipped를 담아 applySuccess로 판정한다", () => {
  const outcome = interpretImportResponse(
    true,
    { created: 2, skipped: [{ rowNumber: 2, reason: "conflict" }], parseErrors: [], fileErrors: [], ignoredHeaders: [] },
    false,
  );
  expect(outcome).toEqual({
    kind: "applySuccess",
    created: 2,
    skipped: [{ rowNumber: 2, reason: "conflict" }],
    parseErrors: [],
    fileErrors: [],
    ignoredHeaders: [],
  });
});

test("반영 성공인데 created가 숫자가 아니면 error로 떨어진다", () => {
  const outcome = interpretImportResponse(true, { created: "2" }, false);
  expect(outcome.kind).toBe("error");
});

test("forceEligibleRowNumbers는 conflicts와 duplicatesInFile 행 번호를 합집합·오름차순·중복 제거해 돌려준다", () => {
  const result = forceEligibleRowNumbers({
    conflicts: [{ rowNumber: 5, name: "x", conflictingSlugs: [] }, { rowNumber: 2, name: "y", conflictingSlugs: [] }],
    duplicatesInFile: [{ key: "k1", rowNumbers: [2, 3] }],
  });
  expect(result).toEqual([2, 3, 5]);
});

test("forceEligibleRowNumbers는 충돌/중복이 없으면 빈 배열이다", () => {
  expect(forceEligibleRowNumbers({ conflicts: [], duplicatesInFile: [] })).toEqual([]);
});
