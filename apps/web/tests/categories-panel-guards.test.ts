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

test("도메인은 72색 팔레트에서 고유 색상을 선택한다", () => {
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
