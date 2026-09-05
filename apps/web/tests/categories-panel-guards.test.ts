import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(path.join(root, "src/components/categories-panel.tsx"), "utf8");
const domainsPanel = readFileSync(path.join(root, "src/components/domains-panel.tsx"), "utf8");
const settings = readFileSync(path.join(root, "src/app/settings/page.tsx"), "utf8");
const classifications = readFileSync(path.join(root, "src/app/classifications/page.tsx"), "utf8");
const admin = readFileSync(path.join(root, "src/app/admin/page.tsx"), "utf8");

test("업무 분류는 개인 설정이 아닌 분류 체계 페이지의 compact 테이블에서 관리한다", () => {
  expect(panel).toContain("<table");
  expect(panel).toContain("<tfoot>");
  expect(panel).toContain("한글 이름");
  expect(panel).toContain("English name");
  expect(settings).not.toContain("<CategoriesPanel");
  expect(classifications).toContain("<CategoriesPanel");
  expect(classifications).toContain('isAdmin={user.role === "admin"}');
  expect(classifications).toContain("<DomainsPanel");
  expect(admin).not.toContain("<CategoriesPanel");
});

test("도메인은 축소된 팔레트에서 고유 색상을 선택한다", () => {
  expect(domainsPanel).toContain("DOMAIN_COLOR_PALETTE");
  expect(domainsPanel).toContain("usedColors.has(color.key)");
  expect(domainsPanel).toContain("다른 도메인에서 사용 중");
  expect(domainsPanel).toContain("domain-color-swatch");
});

test("분류 추가는 두 이름을 모두 요구하고 사용 중 삭제 권한을 구분한다", () => {
  expect(panel).toContain("required disabled={Boolean(busyKey)}");
  expect(panel).toContain("!newLabelKo.trim() || !newLabelEn.trim()");
  expect(panel).toContain("!isAdmin && category.usageCount > 0");
  expect(panel).toContain("연결된 용어");
  expect(panel).toContain("관리자만");
});

test("도메인과 업무 분류 순서는 화살표 대신 드래그 앤 드롭으로 바꾼다", () => {
  for (const source of [panel, domainsPanel]) {
    expect(source).toContain("draggable={!busyKey}");
    expect(source).toContain("onDragStart");
    expect(source).toContain("onDragOver");
    expect(source).toContain("onDrop");
    expect(source).toContain("reorderByKey");
    expect(source).not.toContain("위로 이동");
    expect(source).not.toContain("아래로 이동");
  }
});

test("분류 테이블은 행별 저장 없이 하단 저장과 아이콘 삭제를 사용한다", () => {
  for (const source of [panel, domainsPanel]) {
    expect(source).toContain("변경사항 저장");
    expect(source).toContain("dirtyKeys.size");
    expect(source).toContain("<DeleteIcon />");
    expect(source).toContain("GRID_INPUT_CLASS");
    expect(source).toContain("[&_td]:border");
    expect(source).not.toContain(">저장</button>");
    expect(source).not.toContain('font-semibold text-brand">추가');
  }
});

test("드래그 중에는 행 전체 고스트와 주변 행 이동 애니메이션을 제공한다", () => {
  for (const source of [panel, domainsPanel]) {
    expect(source).toContain("setTableRowDragImage");
    expect(source).toContain("rowDragOffset(index, dragPreview)");
    expect(source).toContain("transition-[transform,opacity,background-color]");
    expect(source).toContain('draggedKey ===');
    expect(source).toContain('"opacity-0"');
    expect(source).toContain("whitespace-nowrap");
  }
});
