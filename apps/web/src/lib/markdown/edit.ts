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
  const nextLines = selection.lines.map((line) => {
    if (!line.trim()) return line;
    const plain = line.replace(/^#{1,6}\s+/, "");
    return remove ? plain : `${desired}${plain}`;
  });
  const value = nextLines.join("\n");
  return replace(source, selection.start, selection.end, value, 0, value.length);
}

export function toggleQuoteMarkdown(source: string, from: number, to: number): MarkdownEdit {
  const selection = lineSelection(source, from, to);
  const nonEmpty = selection.lines.filter((line) => line.trim().length > 0);
  const remove = nonEmpty.length > 0 && nonEmpty.every((line) => /^\s*>\s?/.test(line));
  const value = selection.lines
    .map((line) => remove ? line.replace(/^(\s*)>\s?/, "$1") : line.trim() ? `> ${line}` : ">")
    .join("\n");
  return replace(source, selection.start, selection.end, value, 0, value.length);
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
  const value = selection.lines.map((line) => {
    if (!line.trim()) return line;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const plain = line.replace(ANY_LIST_PREFIX, "$1").slice(indent.length);
    if (remove) return `${indent}${plain}`;
    number += 1;
    const marker = kind === "bullet" ? "- " : kind === "ordered" ? `${number}. ` : "- [ ] ";
    return `${indent}${marker}${plain}`;
  }).join("\n");
  return replace(source, selection.start, selection.end, value, 0, value.length);
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
