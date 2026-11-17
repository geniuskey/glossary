import { expect, test } from "vitest";
import {
  indentListMarkdown,
  insertLinkMarkdown,
  insertMarkdownBlock,
  markdownFormatState,
  pasteLinkMarkdown,
  setParagraphMarkdown,
  toggleCodeBlockMarkdown,
  toggleHeadingMarkdown,
  toggleListMarkdown,
  toggleQuoteMarkdown,
  wrapMarkdown,
} from "../src/lib/markdown/edit.js";
import { matchSlashCommands, SLASH_COMMANDS, slashCommandQuery } from "../src/lib/markdown/slash-commands.js";

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

test("빈 줄에서 제목·목록·인용을 누르면 접두어를 넣고 커서를 그 뒤에 둔다", () => {
  expect(toggleHeadingMarkdown("", 0, 0, 2)).toEqual({ text: "## ", anchor: 3, head: 3 });
  expect(toggleListMarkdown("앞\n\n뒤", 2, 2, "task")).toEqual({ text: "앞\n- [ ] \n뒤", anchor: 8, head: 8 });
  expect(toggleQuoteMarkdown("", 0, 0)).toEqual({ text: "> ", anchor: 2, head: 2 });
  // 같은 버튼을 다시 누르면 접두어만 걷힌다.
  expect(toggleHeadingMarkdown("## ", 3, 3, 2).text).toBe("");
});

test("커서만 있을 때 줄 서식을 바꾸면 줄 전체를 선택하지 않고 같은 글자 위치에 커서를 둔다", () => {
  // 서식 편집 모드는 선택된 줄을 원문으로 보여 주므로, 줄 전체 선택은 "적용이 안 된 것처럼" 보였다.
  expect(toggleHeadingMarkdown("제목입니다", 2, 2, 1)).toEqual({ text: "# 제목입니다", anchor: 4, head: 4 });
  expect(toggleHeadingMarkdown("# 제목입니다", 4, 4, 3)).toEqual({ text: "### 제목입니다", anchor: 6, head: 6 });
  expect(toggleListMarkdown("- 항목", 4, 4, "bullet")).toEqual({ text: "항목", anchor: 2, head: 2 });
  expect(setParagraphMarkdown("### 제목", 5, 5)).toEqual({ text: "제목", anchor: 1, head: 1 });
});

test("링크 삽입은 다음에 입력할 자리를 선택하고, 링크 안에서 다시 누르면 링크를 푼다", () => {
  expect(insertLinkMarkdown("문서", 0, 2)).toEqual({ text: "[문서](https://)", anchor: 5, head: 13 });
  expect(insertLinkMarkdown("", 0, 0)).toEqual({ text: "[링크 텍스트](https://)", anchor: 1, head: 7 });
  expect(insertLinkMarkdown("https://a.dev", 0, 13).text).toBe("[링크 텍스트](https://a.dev)");
  expect(insertLinkMarkdown("앞 [문서](https://a.dev) 뒤", 4, 4)).toEqual({ text: "앞 문서 뒤", anchor: 2, head: 4 });
});

test("글을 선택한 채 URL을 붙여 넣으면 링크가 되고, 그 밖의 붙여넣기는 건드리지 않는다", () => {
  expect(pasteLinkMarkdown("용어집 문서", 4, 6, "https://example.com/doc")?.text).toBe("용어집 [문서](https://example.com/doc)");
  expect(pasteLinkMarkdown("용어집 문서", 4, 4, "https://example.com")).toBeNull();
  expect(pasteLinkMarkdown("용어집 문서", 4, 6, "그냥 텍스트")).toBeNull();
  expect(pasteLinkMarkdown("a\nb", 0, 3, "https://example.com")).toBeNull();
});

test("Tab 들여쓰기는 목록 줄에서만 동작해 그 밖에서는 포커스 이동을 막지 않는다", () => {
  expect(indentListMarkdown("- 항목", 3, 3, 1)).toEqual({ text: "  - 항목", anchor: 5, head: 5 });
  expect(indentListMarkdown("  - 항목", 5, 5, -1)).toEqual({ text: "- 항목", anchor: 3, head: 3 });
  expect(indentListMarkdown("1. 항목", 3, 3, 1)?.text).toBe("   1. 항목");
  expect(indentListMarkdown("일반 문장", 2, 2, 1)).toBeNull();
  expect(indentListMarkdown("- 항목", 3, 3, -1)).toBeNull();
});

test("툴바 활성 상태는 커서 위치의 서식을 판정한다", () => {
  const line = "**굵게** *기울임* `코드` [링크](https://a.dev) ~~취소~~";
  expect(markdownFormatState(line, 3, 3)).toMatchObject({ bold: true, italic: false });
  expect(markdownFormatState(line, 10, 10)).toMatchObject({ bold: false, italic: true });
  expect(markdownFormatState(line, line.indexOf("코드") + 1, line.indexOf("코드") + 1)).toMatchObject({ code: true });
  expect(markdownFormatState(line, line.indexOf("링크"), line.indexOf("링크"))).toMatchObject({ link: true });
  expect(markdownFormatState(line, line.indexOf("취소"), line.indexOf("취소"))).toMatchObject({ strike: true });
  expect(markdownFormatState("## 제목", 4, 4)).toMatchObject({ heading: 2 });
  expect(markdownFormatState("- [ ] 할 일", 7, 7)).toMatchObject({ task: true, bullet: false });
  expect(markdownFormatState("> 인용", 3, 3)).toMatchObject({ quote: true });
  expect(markdownFormatState("```\n**코드**\n```", 6, 6)).toMatchObject({ codeBlock: true, bold: false });
});

test("`/` 블록 메뉴는 줄 맨 앞에서만 열리고 한글·영문 별칭으로 찾는다", () => {
  expect(slashCommandQuery("/")).toEqual({ offset: 0, query: "" });
  expect(slashCommandQuery("  /표")).toEqual({ offset: 2, query: "표" });
  expect(slashCommandQuery("2024/01")).toBeNull();
  expect(slashCommandQuery("및 /또는")).toBeNull();
  expect(matchSlashCommands("표").map((command) => command.action)).toEqual(["table"]);
  expect(matchSlashCommands("h2").map((command) => command.action)).toEqual(["heading-2"]);
  expect(matchSlashCommands("수식").map((command) => command.action)).toContain("block-math");
  expect(matchSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
});
