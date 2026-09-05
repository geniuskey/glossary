import { expect, test } from "vitest";
import { normalizeDisplayMath } from "../src/lib/markdown/normalize.js";

test("여러 줄 블록 수식의 compact 구분자를 독립된 줄로 옮긴다", () => {
  expect(normalizeDisplayMath("$$a +\nb$$")).toBe("$$\na +\nb\n$$");
});

test("코드 블록 안의 수식 표기는 변경하지 않는다", () => {
  const markdown = "```text\n$$a +\nb$$\n```";
  expect(normalizeDisplayMath(markdown)).toBe(markdown);
});

test("한 줄 수식과 이미 표준 형태인 블록 수식은 변경하지 않는다", () => {
  expect(normalizeDisplayMath("$$a + b$$\n\n$$\na + b\n$$")).toBe("$$a + b$$\n\n$$\na + b\n$$");
});
