import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const grid = readFileSync(path.join(testDir, "..", "src", "components", "terms-grid.tsx"), "utf8");
const sheet = readFileSync(path.join(testDir, "..", "src", "app", "sheet", "page.tsx"), "utf8");

test("시트 붙여넣기는 쓰기 전에 서버 사전 검사를 거치고 모든 오류를 모달에 표시한다", () => {
  const checkIndex = grid.indexOf('fetch("/api/v1/terms/paste-check"');
  const commitIndex = grid.indexOf("const [, added] = await Promise.all", checkIndex);
  expect(checkIndex).toBeGreaterThan(-1);
  expect(commitIndex).toBeGreaterThan(checkIndex);
  expect(grid).toContain("setPasteIssues(plan.errors)");
  expect(grid).toContain('aria-labelledby="paste-errors-title"');
  expect(grid).toContain("발견된 오류 {pasteIssues.length.toLocaleString");
  expect(grid).toContain("pasteIssues.map");
});

test("시트는 분류 체계의 도메인 색상을 셀과 선택 목록에 전달한다", () => {
  expect(sheet).toContain("domainColors={domainOptions.map");
  expect(grid).toContain('className={cx("shrink-0 rounded border px-1.5 py-0.5 text-[11px]", domainColors.has(d) ? "domain-color-chip"');
  expect(grid).toContain("style={domainColors.has(d) ? domainColorStyle(domainColors.get(d)) : undefined}");
});
