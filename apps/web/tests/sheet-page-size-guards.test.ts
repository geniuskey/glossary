import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const grid = readFileSync(path.join(root, "src/components/terms-grid.tsx"), "utf8");
const sheet = readFileSync(path.join(root, "src/app/sheet/page.tsx"), "utf8");

test("시트의 행 수 선택은 조회 크기와 페이지 이동 링크에 함께 반영된다", () => {
  expect(sheet).toContain("pageSize: parsed.pageSize");
  expect(sheet).toContain("paginationInfo(parsed.page, total, parsed.pageSize)");
  expect(sheet).toContain("[...PAGE_SIZE_OPTIONS, parsed.pageSize]");
  expect(sheet).toContain("buildPageSizeHref(parsed, pageSize)");
  expect(grid).toContain('aria-label="페이지당 행 수"');
  expect(grid).toContain("props.onPageSizeChange(Number(event.target.value))");
});
