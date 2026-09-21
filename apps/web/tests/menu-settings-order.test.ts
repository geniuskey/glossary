import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  DEFAULT_WORKSPACE_MENU_ORDER,
  moveWorkspaceMenu,
  normalizeWorkspaceMenuOrder,
} from "../src/lib/workspace/menu-settings-values.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(path.join(testDir, "..", "src", "app", "admin", "menu-settings-panel.tsx"), "utf8");
const shellSource = readFileSync(path.join(testDir, "..", "src", "components", "app-shell.tsx"), "utf8");

test("기본 메뉴 순서는 핵심 작업에서 관리 도구로 이어진다", () => {
  expect(DEFAULT_WORKSPACE_MENU_ORDER).toEqual([
    "sheet",
    "contribute",
    "field-completion",
    "check",
    "classifications",
    "graph",
    "wiki",
    "meetings",
    "chat",
    "import",
    "api",
    "statistics",
  ]);
});

test("기존 설정의 누락·중복 메뉴 순서를 현재 전체 메뉴로 정규화한다", () => {
  expect(normalizeWorkspaceMenuOrder(["wiki", "sheet", "wiki", "unknown"])).toEqual([
    "wiki",
    "sheet",
    ...DEFAULT_WORKSPACE_MENU_ORDER.filter((key) => key !== "wiki" && key !== "sheet"),
  ]);
});

test("메뉴를 드롭 위치의 앞이나 뒤로 이동한다", () => {
  const order = ["contribute", "check", "sheet", "wiki"] as const;
  expect(moveWorkspaceMenu(order, "wiki", "check", "before")).toEqual(["contribute", "wiki", "check", "sheet"]);
  expect(moveWorkspaceMenu(order, "contribute", "sheet", "after")).toEqual(["check", "sheet", "contribute", "wiki"]);
});

test("관리 화면은 드래그와 키보드로 메뉴 순서를 편집하고 사이드바가 저장 순서를 적용한다", () => {
  expect(panelSource).toContain("handleDragStart");
  expect(panelSource).toContain("handleDragOver");
  expect(panelSource).toContain("handleDrop");
  expect(panelSource).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
  expect(panelSource).toContain("메뉴 위로 이동");
  expect(panelSource).toContain("메뉴 아래로 이동");
  expect(panelSource).toContain('aria-live="polite"');
  expect(shellSource).toContain("menuSettings.order.map");
  expect(shellSource).toContain(".sort((left, right) =>");
});
