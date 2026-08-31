import { expect, test } from "vitest";
import {
  insertMarkdownBlock,
  toggleCodeBlockMarkdown,
  toggleHeadingMarkdown,
  toggleListMarkdown,
  toggleQuoteMarkdown,
  wrapMarkdown,
} from "../src/lib/markdown/edit.js";

test("인라인 서식은 선택 영역을 감싸고 다시 실행하면 해제한다", () => {
  const bold = wrapMarkdown("hello", 0, 5, "**");
  expect(bold).toMatchObject({ text: "**hello**", anchor: 2, head: 7 });
  expect(wrapMarkdown(bold.text, 0, bold.text.length, "**").text).toBe("hello");
});

test("선택이 없으면 자리표시자를 삽입하고 그 텍스트를 선택한다", () => {
  expect(wrapMarkdown("", 0, 0, "*", "*", "기울임")).toEqual({
    text: "*기울임*",
    anchor: 1,
    head: 4,
  });
});

test("H1~H6 제목은 기존 제목 수준을 교체하고 같은 수준이면 해제한다", () => {
  expect(toggleHeadingMarkdown("## 제목", 0, 5, 1).text).toBe("# 제목");
  expect(toggleHeadingMarkdown("# 제목", 0, 4, 1).text).toBe("제목");
  expect(toggleHeadingMarkdown("제목", 0, 2, 6).text).toBe("###### 제목");
});

test("여러 줄 목록은 종류를 바꾸고 같은 종류이면 일반 문장으로 되돌린다", () => {
  expect(toggleListMarkdown("alpha\nbeta", 0, 10, "ordered").text).toBe("1. alpha\n2. beta");
  expect(toggleListMarkdown("- alpha\n- beta", 0, 14, "task").text).toBe("- [ ] alpha\n- [ ] beta");
  expect(toggleListMarkdown("- alpha\n- beta", 0, 14, "bullet").text).toBe("alpha\nbeta");
});

test("인용과 코드 블록은 토글된다", () => {
  expect(toggleQuoteMarkdown("첫 줄\n둘째 줄", 0, 8).text).toBe("> 첫 줄\n> 둘째 줄");
  expect(toggleQuoteMarkdown("> 첫 줄\n> 둘째 줄", 0, 12).text).toBe("첫 줄\n둘째 줄");
  const code = toggleCodeBlockMarkdown("const x = 1", 0, 11);
  expect(code.text).toBe("```\nconst x = 1\n```");
  expect(toggleCodeBlockMarkdown(code.text, 0, code.text.length).text).toBe("const x = 1");
});

test("블록 삽입은 앞뒤 문단과 빈 줄로 분리한다", () => {
  expect(insertMarkdownBlock("앞문장뒤", 3, 3, "---").text).toBe("앞문장\n\n---\n\n뒤");
});
