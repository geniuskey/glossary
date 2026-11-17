export interface MarkdownEdit {
  text: string;
  anchor: number;
  head: number;
}

type ListKind = "bullet" | "ordered" | "task";

interface LineSelection {
  start: number;
  end: number;
  lines: string[];
}

function lineSelection(source: string, from: number, to: number): LineSelection {
  const start = source.lastIndexOf("\n", from - 1) + 1;
  const selectionEndsAtLineStart = to > from && source[to - 1] === "\n";
  const searchFrom = selectionEndsAtLineStart ? to - 1 : to;
  const nextBreak = source.indexOf("\n", searchFrom);
  const end = selectionEndsAtLineStart ? to - 1 : nextBreak === -1 ? source.length : nextBreak;
  return { start, end, lines: source.slice(start, end).split("\n") };
}

const LINE_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*/;

/**
 * 줄 단위 토글은 바뀐 줄 전체를 선택해 돌려준다. 그런데 서식 편집 모드는 선택된 줄의
 * Markdown 원문을 그대로 드러내므로, 커서만 있던 상태에서 H1을 누르면 "# 제목"이 원문으로
 * 튀어나와 적용이 안 된 것처럼 보인다. 커서만 있었으면 같은 글자 위치에 커서를 되돌린다.
 */
function lineEdit(source: string, selection: LineSelection, value: string, from: number, to: number): MarkdownEdit {
  if (from !== to || selection.lines.length !== 1) return replace(source, selection.start, selection.end, value, 0, value.length);
  const before = selection.lines[0]!;
  const oldPrefix = LINE_PREFIX.exec(before)?.[0].length ?? 0;
  const newPrefix = LINE_PREFIX.exec(value)?.[0].length ?? 0;
  const column = Math.max(newPrefix, Math.min(value.length, from - selection.start - oldPrefix + newPrefix));
  return replace(source, selection.start, selection.end, value, column, column);
}

function replace(source: string, from: number, to: number, value: string, anchor: number, head: number): MarkdownEdit {
  return {
    text: `${source.slice(0, from)}${value}${source.slice(to)}`,
    anchor: from + anchor,
    head: from + head,
  };
}

export function wrapMarkdown(
  source: string,
  from: number,
  to: number,
  before: string,
  after = before,
  placeholder = "텍스트",
): MarkdownEdit {
  const selected = source.slice(from, to);

  if (selected && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return replace(source, from, to, inner, 0, inner.length);
  }

  if (
    selected
    && from >= before.length
    && source.slice(from - before.length, from) === before
    && source.slice(to, to + after.length) === after
  ) {
    return replace(source, from - before.length, to + after.length, selected, 0, selected.length);
  }

  const content = selected || placeholder;
  const wrapped = `${before}${content}${after}`;
  return replace(source, from, to, wrapped, before.length, before.length + content.length);
}

export function toggleHeadingMarkdown(source: string, from: number, to: number, level: number): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const desired = `${"#".repeat(Math.min(6, Math.max(1, level)))} `;
  const desiredPattern = new RegExp(`^${desired.trim()}\\s+`);
  const nonEmpty = selection.lines.filter((line) => line.trim().length > 0);
  const remove = nonEmpty.length > 0 && nonEmpty.every((line) => desiredPattern.test(line));
  // 빈 줄 하나에서 누르면 lines가 전부 비어 아무 변화가 없었다. 접두어를 넣어 바로 이어 쓰게 한다.
  const single = selection.lines.length === 1;
  const nextLines = selection.lines.map((line) => {
    if (!line.trim()) return single ? desired : line;
    const plain = line.replace(/^#{1,6}\s+/, "");
    return remove ? plain : `${desired}${plain}`;
  });
  return lineEdit(source, selection, nextLines.join("\n"), from, to);
}

/** 제목을 걷어내고 일반 문단으로 되돌린다. 블록 종류 메뉴의 "본문"이다. */
export function setParagraphMarkdown(source: string, from: number, to: number): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const value = selection.lines.map((line) => line.replace(/^(\s{0,3})#{1,6}(?:\s+|$)/, "$1")).join("\n");
  return lineEdit(source, selection, value, from, to);
}

export function toggleQuoteMarkdown(source: string, from: number, to: number): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const nonEmpty = selection.lines.filter((line) => line.trim().length > 0);
  const remove = nonEmpty.length > 0 && nonEmpty.every((line) => /^\s*>\s?/.test(line));
  const single = selection.lines.length === 1;
  const value = selection.lines
    .map((line) => remove ? line.replace(/^(\s*)>\s?/, "$1") : line.trim() ? `> ${line}` : single ? "> " : ">")
    .join("\n");
  return lineEdit(source, selection, value, from, to);
}

const ANY_LIST_PREFIX = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/;

export function toggleListMarkdown(source: string, from: number, to: number, kind: ListKind): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const desiredPattern = kind === "bullet"
    ? /^\s*[-*+]\s+(?!\[[ xX]\]\s+)/
    : kind === "ordered"
      ? /^\s*\d+\.\s+/
      : /^\s*[-*+]\s+\[[ xX]\]\s+/;
  const nonEmpty = selection.lines.filter((line) => line.trim().length > 0);
  const remove = nonEmpty.length > 0 && nonEmpty.every((line) => desiredPattern.test(line));
  let number = 0;
  const single = selection.lines.length === 1;
  const value = selection.lines.map((line) => {
    if (!line.trim()) return single ? (kind === "bullet" ? "- " : kind === "ordered" ? "1. " : "- [ ] ") : line;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const plain = line.replace(ANY_LIST_PREFIX, "$1").slice(indent.length);
    if (remove) return `${indent}${plain}`;
    number += 1;
    const marker = kind === "bullet" ? "- " : kind === "ordered" ? `${number}. ` : "- [ ] ";
    return `${indent}${marker}${plain}`;
  }).join("\n");
  return lineEdit(source, selection, value, from, to);
}

export function toggleCodeBlockMarkdown(source: string, from: number, to: number): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const block = source.slice(selection.start, selection.end);
  const fenced = block.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) return replace(source, selection.start, selection.end, fenced[1]!, 0, fenced[1]!.length);

  const content = block || "코드";
  const value = `\`\`\`\n${content}\n\`\`\``;
  return replace(source, selection.start, selection.end, value, 4, 4 + content.length);
}

export function insertMarkdownBlock(source: string, from: number, to: number, block: string): MarkdownEdit {
  const leading = from > 0 && !source.slice(0, from).endsWith("\n\n")
    ? source[from - 1] === "\n" ? "\n" : "\n\n"
    : "";
  const trailing = to < source.length && !source.slice(to).startsWith("\n\n")
    ? source[to] === "\n" ? "\n" : "\n\n"
    : "";
  const value = `${leading}${block}${trailing}`;
  return replace(source, from, to, value, leading.length, leading.length + block.length);
}

const URL_PATTERN = /^https?:\/\/[^\s<>()]+$/i;

export function isLinkUrl(text: string): boolean {
  return URL_PATTERN.test(text.trim());
}

/**
 * 링크를 넣은 뒤 사용자가 바로 이어서 칠 부분을 선택해 둔다. 예전에는
 * `](https://example.com)`을 넣고 라벨만 선택해서, 주소를 바꾸려면 마우스로
 * 다시 찾아 들어가야 했다. 선택한 글이 있으면 주소 자리를, 없으면 라벨 자리를 고른다.
 * 커서가 이미 링크 안에 있으면 링크를 풀고 라벨만 남긴다.
 */
export function insertLinkMarkdown(source: string, from: number, to: number): MarkdownEdit {
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const lineEndIndex = source.indexOf("\n", to);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const line = source.slice(lineStart, lineEnd);
  for (const match of line.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
    const start = lineStart + (match.index ?? 0);
    const end = start + match[0].length;
    if (from >= start && to <= end) {
      const label = match[1] ?? "";
      return replace(source, start, end, label, 0, label.length);
    }
  }

  const selected = source.slice(from, to);
  if (selected && isLinkUrl(selected)) {
    const label = "링크 텍스트";
    return replace(source, from, to, `[${label}](${selected.trim()})`, 1, 1 + label.length);
  }
  if (selected) {
    const url = "https://";
    return replace(source, from, to, `[${selected}](${url})`, selected.length + 3, selected.length + 3 + url.length);
  }
  const label = "링크 텍스트";
  return replace(source, from, to, `[${label}](https://)`, 1, 1 + label.length);
}

/** 글을 선택한 채 URL을 붙여 넣으면 그 글을 링크로 만든다. 해당하지 않으면 null. */
export function pasteLinkMarkdown(source: string, from: number, to: number, pasted: string): MarkdownEdit | null {
  const selected = source.slice(from, to);
  if (!selected || selected.includes("\n") || isLinkUrl(selected) || !isLinkUrl(pasted)) return null;
  const value = `[${selected}](${pasted.trim()})`;
  return replace(source, from, to, value, value.length, value.length);
}

/**
 * 목록 줄에서만 Tab으로 들여쓴다. 목록이 아닌 곳의 Tab은 브라우저 기본 동작(다음
 * 컨트롤로 이동)으로 남겨야 키보드 사용자가 편집기 밖으로 나갈 수 있다. 그래서
 * 해당하지 않으면 null을 돌려 CodeMirror가 다음 핸들러로 넘기게 한다.
 */
export function indentListMarkdown(source: string, from: number, to: number, direction: 1 | -1): MarkdownEdit | null {
  const selection = lineSelection(source, from, to);
  const listLine = /^(\s*)([-*+]|\d+[.)])\s+/;
  if (!selection.lines.every((line) => !line.trim() || listLine.test(line))) return null;
  if (!selection.lines.some((line) => listLine.test(line))) return null;
  let shift = 0;
  const value = selection.lines.map((line, index) => {
    const match = listLine.exec(line);
    if (!match) return line;
    const width = /^\d/.test(match[2] ?? "") ? 3 : 2;
    if (direction === 1) {
      if (index === 0) shift = width;
      return `${" ".repeat(width)}${line}`;
    }
    const remove = Math.min((match[1] ?? "").length, width);
    if (index === 0) shift = -remove;
    return line.slice(remove);
  }).join("\n");
  if (value === selection.lines.join("\n")) return null;
  if (from === to && selection.lines.length === 1) {
    const column = Math.max(0, from - selection.start + shift);
    return replace(source, selection.start, selection.end, value, column, column);
  }
  return replace(source, selection.start, selection.end, value, 0, value.length);
}

export interface MarkdownFormatState {
  /** 0은 일반 문단, 1~6은 제목 수준 */
  heading: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  math: boolean;
  quote: boolean;
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  codeBlock: boolean;
}

export const EMPTY_FORMAT_STATE: MarkdownFormatState = {
  heading: 0, bold: false, italic: false, strike: false, code: false, link: false, math: false,
  quote: false, bullet: false, ordered: false, task: false, codeBlock: false,
};

function insideMatch(line: string, pattern: RegExp, from: number, to: number, inner: (match: RegExpMatchArray) => [number, number]): boolean {
  for (const match of line.matchAll(pattern)) {
    const [start, end] = inner(match);
    if (from >= start && to <= end) return true;
  }
  return false;
}

/**
 * 툴바가 "지금 커서 위치에 무엇이 적용돼 있는지" 보여 주기 위한 판정이다. 렌더러와
 * 똑같은 파서를 쓰지는 않지만, 라이브 프리뷰가 표시하는 범위와 같은 정규식 계열을 써서
 * 화면에 굵게 보이는 곳에서 굵게 버튼이 눌려 있도록 맞춘다.
 */
export function markdownFormatState(source: string, from: number, to: number, inCodeBlock?: boolean): MarkdownFormatState {
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const lineEndIndex = source.indexOf("\n", from);
  const line = source.slice(lineStart, lineEndIndex === -1 ? source.length : lineEndIndex);
  // 편집기는 매 커서 이동마다 부르므로 문서 전체를 넘기지 않고 현재 줄과 구문 트리 판정만 넘긴다.
  const codeBlock = inCodeBlock
    ?? (source.slice(0, lineStart).split("\n").filter((text) => /^ {0,3}(`{3,}|~{3,})/.test(text)).length % 2 === 1
      || /^ {0,3}(`{3,}|~{3,})/.test(line));
  if (codeBlock) return { ...EMPTY_FORMAT_STATE, codeBlock: true };

  const start = from - lineStart;
  const end = Math.min(line.length, to - lineStart);
  const heading = /^ {0,3}(#{1,6})(?:\s+|$)/.exec(line)?.[1]?.length ?? 0;
  const list = /^\s*(?:>\s?)?([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
  const wrapped = (marker: number) => (match: RegExpMatchArray): [number, number] => {
    const index = match.index ?? 0;
    return [index + marker, index + match[0].length - marker];
  };
  return {
    heading,
    bold: insideMatch(line, /(\*\*|__)(\S(?:.*?\S)?)\1/g, start, end, wrapped(2)),
    italic: insideMatch(line, /(?<![*_])([*_])(?![*_\s])([^*_\n]+?)(?<!\s)\1(?![*_])/g, start, end, wrapped(1)),
    strike: insideMatch(line, /~~(\S(?:.*?\S)?)~~/g, start, end, wrapped(2)),
    code: insideMatch(line, /(`+)([^`\n]+?)\1/g, start, end, (match) => wrapped((match[1] ?? "").length)(match)),
    link: insideMatch(line, /(?<!!)\[([^\]\n]+)\]\(([^)\n]*)\)/g, start, end, (match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]),
    math: insideMatch(line, /\$([^$\n]+)\$/g, start, end, wrapped(1)),
    quote: /^ {0,3}>/.test(line),
    bullet: Boolean(list && /[-*+]/.test(list[1] ?? "") && !list[2]),
    ordered: Boolean(list && /^\d/.test(list[1] ?? "")),
    task: Boolean(list?.[2]),
    codeBlock: false,
  };
}

export function sameFormatState(left: MarkdownFormatState, right: MarkdownFormatState): boolean {
  return (Object.keys(left) as Array<keyof MarkdownFormatState>).every((key) => left[key] === right[key]);
}

