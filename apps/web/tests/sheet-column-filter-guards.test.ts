import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const grid = readFileSync(path.join(root, "src/components/terms-grid.tsx"), "utf8");
const filterBar = readFileSync(path.join(root, "src/components/sheet-filter-bar.tsx"), "utf8");
const sheetPage = readFileSync(path.join(root, "src/app/sheet/page.tsx"), "utf8");

test("구조화 필터는 상단 바가 아니라 대응하는 열 머리글에 표시한다", () => {
  expect(filterBar).toContain("export function SheetFilterBar({ query }");
  expect(filterBar).not.toContain("filters.map");
  expect(sheetPage).toContain("<SheetFilterBar query={parsed.q ?? \"\"} />");
  expect(sheetPage).toContain("filters={filters}");
  expect(grid).toContain("const COLUMN_FILTER_NAME");
  expect(grid).toContain('status: "status"');
  expect(grid).toContain('group-hover/th:opacity-100');
  expect(grid).toContain("<ColumnFilterPopover");
});

test("머리글 우클릭 메뉴는 필터와 단일 열 설정 진입점만 제공한다", () => {
  expect(grid).toContain('filter.value ? `필터:');
  expect(grid).toContain('<MenuAction onClick={onOpenColumns}>열 설정…</MenuAction>');
  expect(grid).not.toContain('>열 보이기</p>');
  expect(grid).not.toContain('모든 열 보이기');
  expect(grid).toContain('closest("[data-column-resize], [data-column-filter]")');
});
