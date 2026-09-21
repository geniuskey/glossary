import { RangeSetBuilder, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, lineNumberWidgetMarker, type DecorationSet } from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownContent } from "@/components/markdown-content";
import { LivePreviewTable } from "@/components/markdown-live-table";
import { internalAttachmentDimensions, isInternalAttachmentUrl } from "@/lib/markdown/images";

type DecoratedRange = Range<Decoration>;
interface ReplacementSpan { from: number; to: number }

const HIDDEN_MARKUP = Decoration.replace({});
const replacementSpans = new WeakMap<DecoratedRange[], ReplacementSpan[]>();

class LivePreviewTextWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof LivePreviewTextWidget
      && widget.text === this.text
      && widget.className === this.className;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = `cm-live-preview-widget ${this.className}`;
    element.textContent = this.text;
    return element;
  }

  ignoreEvent() {
    return true;
  }
}

class LivePreviewImageWidget extends WidgetType {
  constructor(private readonly source: string, private readonly alt: string) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof LivePreviewImageWidget
      && widget.source === this.source
      && widget.alt === this.alt;
  }

  toDOM(view: EditorView) {
    const image = document.createElement("img");
    image.className = "cm-live-preview-image";
    image.src = this.source;
    image.alt = this.alt;
    const dimensions = internalAttachmentDimensions(this.source);
    if (dimensions) {
      image.width = dimensions.width;
      image.height = dimensions.height;
    }
    image.loading = "lazy";
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("load", () => view.requestMeasure(), { once: true });
    image.addEventListener("error", () => view.requestMeasure(), { once: true });
    return image;
  }

  ignoreEvent() {
    return true;
  }
}

class LivePreviewLineNumberMarker extends GutterMarker {
  constructor(private readonly lineNumber: number) {
    super();
  }

  eq(marker: GutterMarker): boolean {
    return marker instanceof LivePreviewLineNumberMarker && marker.lineNumber === this.lineNumber;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-live-preview-line-number";
    element.textContent = String(this.lineNumber);
    return element;
  }
}

class LivePreviewBlockWidget extends WidgetType {
  private root: Root | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mouseDown: ((event: MouseEvent) => void) | null = null;

  constructor(
    private readonly source: string,
    private readonly kind: "mermaid" | "table" | "math",
    private readonly isTrailingBlock = false,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof LivePreviewBlockWidget
      && widget.source === this.source
      && widget.kind === this.kind
      && widget.isTrailingBlock === this.isTrailingBlock;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-live-preview-block";
    element.dataset.livePreviewBlock = this.kind;
    element.setAttribute("aria-label", this.kind === "table" ? "Markdown 표 미리보기" : this.kind === "math" ? "수식 미리보기" : "Mermaid 다이어그램 미리보기");
    this.root = createRoot(element);
    const content = this.kind === "table"
      ? createElement(LivePreviewTable, {
        source: this.source,
        onChange: (source) => this.replaceSource(view, element, source),
      })
      : createElement(MarkdownContent, {
        children: this.source,
        className: "cm-live-preview-block-content",
      });
    const control = this.kind === "table"
      ? this.isTrailingBlock
        ? createElement("button", {
          type: "button",
          className: "cm-live-preview-add-paragraph",
          "data-live-preview-control": "true",
          "aria-label": "표 아래에 문단 추가",
          title: "표 아래에 문단 추가",
          onClick: () => this.addParagraph(view, element),
        }, "+")
        : null
      : createElement("button", {
        type: "button",
        className: "cm-live-preview-edit",
        "data-live-preview-control": "true",
        "aria-label": this.kind === "math" ? "수식 원문 편집" : "Mermaid 원문 편집",
        title: this.kind === "math" ? "수식 원문 편집" : "Mermaid 원문 편집",
        onClick: () => this.editSource(view, element),
      }, "</>");
    this.root.render(createElement("div", { className: "cm-live-preview-block-inner" }, content, control));

    this.mouseDown = (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("[data-live-table-control], [data-live-table-cell], [data-live-preview-control]")) {
        event.stopPropagation();
        return;
      }
      if (this.kind === "table") {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      try {
        const position = view.posAtDOM(element, 0);
        view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
        view.focus();
      } catch {
        // CodeMirror may remove a block between the pointer event and lookup.
      }
    };
    element.addEventListener("mousedown", this.mouseDown);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => view.requestMeasure());
      this.resizeObserver.observe(element);
    }
    return element;
  }

  private replaceSource(view: EditorView, element: HTMLElement, source: string) {
    if (source === this.source) return;
    try {
      const from = view.posAtDOM(element, 0);
      view.dispatch({ changes: { from, to: from + this.source.length, insert: source } });
    } catch {
      // CodeMirror may remove a block between a table action and its update.
    }
  }

  private editSource(view: EditorView, element: HTMLElement) {
    try {
      const from = view.posAtDOM(element, 0);
      view.dispatch({ selection: { anchor: from, head: from + this.source.length }, scrollIntoView: true });
      view.focus();
    } catch {
      // CodeMirror may remove a block between the pointer event and lookup.
    }
  }

  private addParagraph(view: EditorView, element: HTMLElement) {
    try {
      const from = view.posAtDOM(element, 0) + this.source.length;
      const insertion = "\n\n";
      view.dispatch({
        changes: { from, to: from, insert: insertion },
        selection: { anchor: from + insertion.length },
        scrollIntoView: true,
      });
      view.focus();
    } catch {
      // CodeMirror may remove a block between the pointer event and lookup.
    }
  }

  destroy(element: HTMLElement) {
    if (this.mouseDown) element.removeEventListener("mousedown", this.mouseDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const root = this.root;
    this.root = null;
    // CodeMirror can destroy a widget during a React event/render cycle. React
    // does not allow a root to be synchronously unmounted from inside that cycle.
    if (root) setTimeout(() => root.unmount(), 0);
  }
}

const LIVE_PREVIEW_DECORATIONS = {
  heading: [1, 2, 3, 4, 5, 6].map((level) => Decoration.mark({ class: `cm-live-heading-${level}` })),
  quote: Decoration.mark({ class: "cm-live-quote" }),
  list: Decoration.mark({ class: "cm-live-list" }),
  codeBlock: Decoration.mark({ class: "cm-live-code-block" }),
  code: Decoration.mark({ class: "cm-live-inline-code" }),
  strong: Decoration.mark({ class: "cm-live-strong" }),
  emphasis: Decoration.mark({ class: "cm-live-emphasis" }),
  strike: Decoration.mark({ class: "cm-live-strike" }),
  link: Decoration.mark({ class: "cm-live-link" }),
  image: Decoration.mark({ class: "cm-live-image" }),
  math: Decoration.mark({ class: "cm-live-math" }),
};

function activeLineNumbers(state: EditorState): Set<number> {
  const active = new Set<number>();
  for (const range of state.selection.ranges) {
    if (range.from !== range.to) continue;
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let number = from; number <= to; number += 1) active.add(number);
  }
  return active;
}

function selectedLineNumbers(state: EditorState): Set<number> {
  const selected = new Set<number>();
  for (const range of state.selection.ranges) {
    if (range.from === range.to) continue;
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let number = from; number <= to; number += 1) selected.add(number);
  }
  return selected;
}

function addRange(ranges: DecoratedRange[], from: number, to: number, decoration: DecoratedRange["value"]) {
  if (to > from) ranges.push(decoration.range(from, to));
}

function hasReplacement(ranges: DecoratedRange[], from: number, to: number): boolean {
  const spans = replacementSpans.get(ranges);
  if (!spans?.length) return false;
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.from < from) low = middle + 1;
    else high = middle;
  }
  return (low > 0 && spans[low - 1]!.to > from) || (low < spans.length && spans[low]!.from < to);
}

function trackReplacement(ranges: DecoratedRange[], from: number, to: number) {
  const spans = replacementSpans.get(ranges) ?? [];
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.from < from) low = middle + 1;
    else high = middle;
  }
  spans.splice(low, 0, { from, to });
  replacementSpans.set(ranges, spans);
}

function hide(ranges: DecoratedRange[], from: number, to: number) {
  if (to <= from || hasReplacement(ranges, from, to)) return;
  addRange(ranges, from, to, HIDDEN_MARKUP);
  trackReplacement(ranges, from, to);
}

function replace(ranges: DecoratedRange[], from: number, to: number, text: string, className: string) {
  if (to <= from || hasReplacement(ranges, from, to)) return;
  addRange(ranges, from, to, Decoration.replace({ widget: new LivePreviewTextWidget(text, className) }));
  trackReplacement(ranges, from, to);
}

function replaceImage(ranges: DecoratedRange[], from: number, to: number, source: string, alt: string) {
  if (to <= from || hasReplacement(ranges, from, to)) return;
  addRange(ranges, from, to, Decoration.replace({ widget: new LivePreviewImageWidget(source, alt) }));
  trackReplacement(ranges, from, to);
}

function mark(ranges: DecoratedRange[], from: number, to: number, decoration: DecoratedRange["value"]) {
  addRange(ranges, from, to, decoration);
}

function blockSource(state: EditorState, start: number, end: number): string {
  return state.doc.sliceString(state.doc.line(start).from, state.doc.line(end).to);
}

function hasActiveLine(active: Set<number>, start: number, end: number): boolean {
  for (let number = start; number <= end; number += 1) {
    if (active.has(number)) return true;
  }
  return false;
}

function replaceBlock(
  state: EditorState,
  ranges: DecoratedRange[],
  start: number,
  end: number,
  kind: "mermaid" | "table" | "math",
  isTrailingBlock = false,
) {
  const from = state.doc.line(start).from;
  const to = state.doc.line(end).to;
  if (hasReplacement(ranges, from, to)) return;
  addRange(ranges, from, to, Decoration.replace({
    block: true,
    widget: new LivePreviewBlockWidget(blockSource(state, start, end), kind, isTrailingBlock),
  }));
  trackReplacement(ranges, from, to);
}

function findFenceEnd(state: EditorState, start: number, fence: RegExpExecArray): number | null {
  const marker = fence[1] ?? "";
  const character = marker[0];
  for (let number = start + 1; number <= state.doc.lines; number += 1) {
    const candidate = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(state.doc.line(number).text);
    const candidateMarker = candidate?.[1] ?? "";
    if (candidate && candidateMarker[0] === character && candidateMarker.length >= marker.length) return number;
  }
  return null;
}

function findTableEnd(state: EditorState, start: number): number | null {
  if (start >= state.doc.lines || !/^\s*\|?.+\|.+\|?\s*$/.test(state.doc.line(start).text)) return null;
  const separator = state.doc.line(start + 1).text.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = separator.split("|").map((cell) => cell.trim());
  if (cells.length < 2 || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;

  let end = start + 1;
  while (end < state.doc.lines && /\|/.test(state.doc.line(end + 1).text.trim())) end += 1;
  return end;
}

function findDisplayMathEnd(state: EditorState, start: number): number | null {
  const first = state.doc.line(start).text;
  if (/^\s{0,3}\$\$(?!\$).+\$\$\s*$/.test(first)) return start;
  if (!/^\s{0,3}\$\$(?!\$)/.test(first)) return null;
  for (let number = start + 1; number <= state.doc.lines; number += 1) {
    const text = state.doc.line(number).text;
    if (/^\s{0,3}\$\$\s*$/.test(text) || /^(.*\S)\$\$\s*$/.test(text)) return number;
  }
  return null;
}

function decorateInlineMarkdown(lineText: string, lineFrom: number, ranges: DecoratedRange[]) {
  const links = /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of lineText.matchAll(links)) {
    const start = match.index ?? 0;
    const image = match[1] === "!";
    const labelStart = start + (image ? 2 : 1);
    const labelEnd = labelStart + (match[2] ?? "").length;
    const source = (match[3] ?? "").trim();
    if (image && isInternalAttachmentUrl(source)) {
      const alt = (match[2] ?? "").replaceAll(/\\([\\\]])/g, "$1");
      replaceImage(ranges, lineFrom + start, lineFrom + start + match[0].length, source, alt);
      continue;
    }
    mark(ranges, lineFrom + labelStart, lineFrom + labelEnd, image ? LIVE_PREVIEW_DECORATIONS.image : LIVE_PREVIEW_DECORATIONS.link);
    hide(ranges, lineFrom + start, lineFrom + labelStart);
    hide(ranges, lineFrom + labelEnd, lineFrom + start + match[0].length);
  }

  const code = /(`+)([^`\n]+?)\1/g;
  for (const match of lineText.matchAll(code)) {
    const start = match.index ?? 0;
    const markerLength = (match[1] ?? "").length;
    mark(ranges, lineFrom + start + markerLength, lineFrom + start + match[0].length - markerLength, LIVE_PREVIEW_DECORATIONS.code);
    hide(ranges, lineFrom + start, lineFrom + start + markerLength);
    hide(ranges, lineFrom + start + match[0].length - markerLength, lineFrom + start + match[0].length);
  }

  const strong = /(\*\*|__)(\S(?:.*?\S)?)\1/g;
  for (const match of lineText.matchAll(strong)) {
    const start = match.index ?? 0;
    const markerLength = (match[1] ?? "").length;
    mark(ranges, lineFrom + start + markerLength, lineFrom + start + match[0].length - markerLength, LIVE_PREVIEW_DECORATIONS.strong);
    hide(ranges, lineFrom + start, lineFrom + start + markerLength);
    hide(ranges, lineFrom + start + match[0].length - markerLength, lineFrom + start + match[0].length);
  }

  const strike = /~~(\S(?:.*?\S)?)~~/g;
  for (const match of lineText.matchAll(strike)) {
    const start = match.index ?? 0;
    mark(ranges, lineFrom + start + 2, lineFrom + start + match[0].length - 2, LIVE_PREVIEW_DECORATIONS.strike);
    hide(ranges, lineFrom + start, lineFrom + start + 2);
    hide(ranges, lineFrom + start + match[0].length - 2, lineFrom + start + match[0].length);
  }

  const emphasis = /([*_])([^*_\n]+?)\1/g;
  for (const match of lineText.matchAll(emphasis)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const delimiter = match[1] ?? "";
    if (lineText[start - 1] === delimiter || lineText[end] === delimiter) continue;
    if (start > 0 && !/[\s([{]/.test(lineText[start - 1] ?? "")) continue;
    if (end < lineText.length && !/[\s)\]}!?.,:;]/.test(lineText[end] ?? "")) continue;
    mark(ranges, lineFrom + start + 1, lineFrom + end - 1, LIVE_PREVIEW_DECORATIONS.emphasis);
    hide(ranges, lineFrom + start, lineFrom + start + 1);
    hide(ranges, lineFrom + end - 1, lineFrom + end);
  }

  const math = /\$([^$\n]+)\$/g;
  for (const match of lineText.matchAll(math)) {
    const start = match.index ?? 0;
    mark(ranges, lineFrom + start + 1, lineFrom + start + match[0].length - 1, LIVE_PREVIEW_DECORATIONS.math);
    hide(ranges, lineFrom + start, lineFrom + start + 1);
    hide(ranges, lineFrom + start + match[0].length - 1, lineFrom + start + match[0].length);
  }
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const active = activeLineNumbers(state);
  const selected = selectedLineNumbers(state);
  const ranges: DecoratedRange[] = [];
  let inCodeBlock = false;

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const text = line.text;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);

    if (fence) {
      if (!inCodeBlock) {
        const fenceEnd = findFenceEnd(state, number, fence);
        const language = (fence[2] ?? "").trim().split(/\s+/, 1)[0]?.toLowerCase();
        if (language === "mermaid" && fenceEnd !== null && !hasActiveLine(active, number, fenceEnd) && !hasActiveLine(selected, number, fenceEnd)) {
          replaceBlock(state, ranges, number, fenceEnd, "mermaid");
          number = fenceEnd;
          continue;
        }
      }
      if (!active.has(number) && !selected.has(number)) {
        const language = (fence[2] ?? "").trim();
        replace(ranges, line.from, line.to, inCodeBlock ? "코드 블록" : `코드${language ? ` · ${language}` : ""}`, "cm-live-code-fence");
        mark(ranges, line.from, line.to, LIVE_PREVIEW_DECORATIONS.codeBlock);
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      if (!active.has(number) && !selected.has(number)) mark(ranges, line.from, line.to, LIVE_PREVIEW_DECORATIONS.codeBlock);
      continue;
    }

    const tableEnd = findTableEnd(state, number);
    if (tableEnd !== null) {
      replaceBlock(state, ranges, number, tableEnd, "table", tableEnd === state.doc.lines);
      number = tableEnd;
      continue;
    }

    if (active.has(number)) continue;

    const mathEnd = findDisplayMathEnd(state, number);
    if (mathEnd !== null && !hasActiveLine(active, number, mathEnd) && !hasActiveLine(selected, number, mathEnd)) {
      replaceBlock(state, ranges, number, mathEnd, "math");
      number = mathEnd;
      continue;
    }

    const heading = /^( {0,3})(#{1,6})(?:\s+|$)/.exec(text);
    if (heading) {
      const contentStart = heading[0].length;
      mark(ranges, line.from, line.to, LIVE_PREVIEW_DECORATIONS.heading[(heading[2] ?? "").length - 1]!);
      hide(ranges, line.from, line.from + contentStart);
      decorateInlineMarkdown(text.slice(contentStart), line.from + contentStart, ranges);
      continue;
    }

    if (/^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(text)) {
      replace(ranges, line.from, line.to, "", "cm-live-horizontal-rule");
      continue;
    }

    const quote = /^( {0,3}> ?)/.exec(text);
    const list = /^(\s*)([-+*]|\d+[.)])\s+/.exec(text);
    let contentStart = 0;
    if (quote) {
      mark(ranges, line.from, line.to, LIVE_PREVIEW_DECORATIONS.quote);
      contentStart = quote[0].length;
      hide(ranges, line.from, line.from + contentStart);
    } else if (list) {
      mark(ranges, line.from, line.to, LIVE_PREVIEW_DECORATIONS.list);
      contentStart = list[0].length;
      const listMarker = list[2] ?? "";
      const marker = listMarker.match(/^\d/) ? `${listMarker} ` : "• ";
      replace(ranges, line.from + (list[1] ?? "").length, line.from + contentStart, marker, "cm-live-list-marker");
    }

    const remaining = text.slice(contentStart);
    const task = /^(\[[ xX]\])\s+/.exec(remaining);
    if (task) {
      replace(ranges, line.from + contentStart, line.from + contentStart + task[0].length, (task[1] ?? "").toLowerCase() === "[x]" ? "☑ " : "☐ ", "cm-live-task-marker");
      contentStart += task[0].length;
    }
    decorateInlineMarkdown(text.slice(contentStart), line.from + contentStart, ranges);
  }

  ranges.sort((left, right) => left.from - right.from || left.value.startSide - right.value.startSide || left.to - right.to);
  const builder = new RangeSetBuilder<DecoratedRange["value"]>();
  for (const range of ranges) builder.add(range.from, range.to, range.value);
  return builder.finish();
}

function selectionLineKey(state: EditorState): string {
  return state.selection.ranges
    .map((range) => `${state.doc.lineAt(range.from).number}:${state.doc.lineAt(range.to).number}:${range.empty ? "cursor" : "selection"}`)
    .join("|");
}

const livePreviewDecorations = StateField.define<DecorationSet>({
  create: (state) => buildLivePreviewDecorations(state),
  update: (decorations, transaction) => (
    transaction.docChanged || (transaction.selection && selectionLineKey(transaction.startState) !== selectionLineKey(transaction.state))
      ? buildLivePreviewDecorations(transaction.state)
      : decorations
  ),
  provide: (field) => EditorView.decorations.from(field),
});

const livePreviewLineNumberMarkers = lineNumberWidgetMarker.of((view, widget, block) => {
  if (!(widget instanceof LivePreviewBlockWidget)) return null;
  return new LivePreviewLineNumberMarker(view.state.doc.lineAt(block.from).number);
});

export const livePreviewExtension = [livePreviewDecorations, livePreviewLineNumberMarkers];
