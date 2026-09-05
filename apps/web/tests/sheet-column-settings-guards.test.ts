import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const grid = readFileSync(path.join(root, "src/components/terms-grid.tsx"), "utf8");

test("열 설정 드롭다운은 손잡이 드래그 앤 드롭으로 순서를 바꾼다", () => {
  expect(grid).toContain("data-column-setting-row");
  expect(grid).toContain("application/x-glossary-column-setting");
  expect(grid).toContain("startSettingsDrag");
  expect(grid).toContain("dragSettingsOver");
  expect(grid).toContain("dropSetting");
  expect(grid).toContain("onReorderColumn={finishColumnMove}");
  expect(grid).toContain("<ColumnDragDots />");
  expect(grid).not.toContain('title="왼쪽으로 이동"');
  expect(grid).not.toContain('title="오른쪽으로 이동"');
});

test("열 설정 드래그는 전체 항목 고스트와 주변 항목 이동 미리보기를 제공한다", () => {
  expect(grid).toContain("setColumnSettingDragImage");
  expect(grid).toContain("rowDragOffset(index, settingsPreview)");
  expect(grid).toContain('settingsDrag?.source === col.key && "opacity-0"');
  expect(grid).toContain("transition-[transform,opacity,background-color]");
  expect(grid).toContain('event.key !== "ArrowUp" && event.key !== "ArrowDown"');
});
