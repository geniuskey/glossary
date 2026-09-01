import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const sheet = readFileSync(path.join(root, "app", "sheet", "page.tsx"), "utf8");
const share = readFileSync(path.join(root, "components", "sheet-share.tsx"), "utf8");
const embed = readFileSync(path.join(root, "app", "embed", "page.tsx"), "utf8");

test("시트 머리글은 자세히 추가 대신 공유 진입점을 제공한다", () => {
  expect(sheet).not.toContain("자세히 추가");
  expect(sheet).toContain("<SheetShare");
});

test("공유 창은 열 체크박스와 URL·iframe 복사를 모두 제공한다", () => {
  expect(share).toContain("createPortal");
  expect(share).toContain('type="checkbox"');
  expect(share).toContain('copy("url")');
  expect(share).toContain('copy("iframe")');
  expect(share).toContain('aria-live="polite"');
});

test("임베드 화면은 편집 그리드가 아닌 읽기 전용 table이다", () => {
  expect(embed).toContain("<table");
  expect(embed).toContain("<thead");
  expect(embed).not.toContain("<TermsGrid");
  expect(embed).toContain("listPublishedTermRows");
});
