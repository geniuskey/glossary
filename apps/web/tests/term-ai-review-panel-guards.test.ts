import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, "..", "src", "components", "term-ai-review-panel.tsx"), "utf8");

test("AI 검토는 선택형 가이드 입력 하나로 자동·가이드 검토를 구분한다", () => {
  expect(source).not.toContain("ReviewMode");
  expect(source).not.toContain('aria-pressed={reviewMode');
  expect(source).toContain("검토 가이드");
  expect(source).toContain("(선택)");
  expect(source).toContain('...(instruction.trim() ? { instruction: instruction.trim() } : {})');
  expect(source).toContain("maxLength={1_000}");
});

test("가이드 입력은 항상 보이고 비어 있어도 자동 검토를 시작할 수 있다", () => {
  expect(source).not.toContain("guidedWithoutPrompt");
  expect(source).toContain('disabled={disabled || loading} onClick={() => void requestReview()}');
  expect(source).toContain('name="aiReviewInstruction"');
  expect(source).toContain('autoComplete="off"');
  expect(source).toContain("rows={1}");
});

test("검토 결과는 어떤 방식으로 실행했는지 표시한다", () => {
  expect(source).toContain("setReviewedWithGuide(Boolean(instruction.trim()))");
  expect(source).toContain('reviewedWithGuide ? "가이드 포함" : "자동 검토"');
});
