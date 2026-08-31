import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, "..", "src", "components", "markdown-editor.tsx"), "utf8");

test("Markdown 편집기는 화면을 채우는 전체 화면 모드를 제공한다", () => {
  expect(source).toContain('data-markdown-fullscreen={fullscreen}');
  expect(source).toContain('fixed inset-0 z-[100]');
  expect(source).toContain('h-[100dvh]');
  expect(source).toContain('aria-modal={fullscreen || undefined}');
});

test("전체 화면은 Esc로 닫히고 배경 스크롤을 복원한다", () => {
  expect(source).toContain('event.key !== "Escape"');
  expect(source).toContain('setFullscreen(false)');
  expect(source).toContain('document.body.style.overflow = "hidden"');
  expect(source).toContain('document.body.style.overflow = previousOverflow');
});
