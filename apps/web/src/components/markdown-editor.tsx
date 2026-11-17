"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, placeholder, tooltips } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { livePreviewExtension } from "@/lib/markdown/live-preview";
import { cx } from "@/lib/ui/format";
import {
  EMPTY_FORMAT_STATE,
  indentListMarkdown,
  insertLinkMarkdown,
  insertMarkdownBlock,
  markdownFormatState,
  pasteLinkMarkdown,
  sameFormatState,
  setParagraphMarkdown,
  toggleCodeBlockMarkdown,
  toggleHeadingMarkdown,
  toggleListMarkdown,
  toggleQuoteMarkdown,
  wrapMarkdown,
  type MarkdownEdit,
  type MarkdownFormatState,
} from "@/lib/markdown/edit";
import { matchSlashCommands, slashCommandQuery } from "@/lib/markdown/slash-commands";
import { MarkdownContent } from "./markdown-content";
import { EditorIcon, type EditorIconName } from "./markdown-editor-icons";
import { EditorMenu, type EditorMenuItem } from "./markdown-editor-menu";

interface UploadResponse {
  url: string;
  width: number;
  height: number;
  originalFilename: string;
}

interface MarkdownEditorProps {
  name?: string;
  label?: string;
  describedBy?: string;
  invalid?: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  compact?: boolean;
  resizable?: boolean;
  fillAvailable?: boolean;
  defaultView?: MarkdownView;
  embedded?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

export type MarkdownView = "glossary" | "text" | "preview";
type EditMode = Exclude<MarkdownView, "preview">;

function imageFiles(items: Iterable<File>): File[] {
  return [...items].filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
}

function imageAlt(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return (base || "첨부 이미지").replaceAll("]", "\\]");
}

type MarkdownCommand = (source: string, from: number, to: number) => MarkdownEdit;

/** 툴바·단축키·`/` 메뉴가 같은 명령표를 쓴다. 세 곳이 따로 Markdown을 만들면 결과가 어긋난다. */
const COMMANDS: Record<string, MarkdownCommand> = {
  paragraph: setParagraphMarkdown,
  bold: (text, from, to) => wrapMarkdown(text, from, to, "**", "**", "굵은 텍스트"),
  italic: (text, from, to) => wrapMarkdown(text, from, to, "*", "*", "기울임 텍스트"),
  strike: (text, from, to) => wrapMarkdown(text, from, to, "~~", "~~", "취소선 텍스트"),
  "inline-code": (text, from, to) => wrapMarkdown(text, from, to, "`", "`", "코드"),
  link: insertLinkMarkdown,
  "inline-math": (text, from, to) => wrapMarkdown(text, from, to, "$", "$", "E = mc^2"),
  quote: toggleQuoteMarkdown,
  bullet: (text, from, to) => toggleListMarkdown(text, from, to, "bullet"),
  ordered: (text, from, to) => toggleListMarkdown(text, from, to, "ordered"),
  task: (text, from, to) => toggleListMarkdown(text, from, to, "task"),
  "code-block": toggleCodeBlockMarkdown,
  table: (text, from, to) => insertMarkdownBlock(text, from, to, "| 열 1 | 열 2 | 열 3 |\n| --- | --- | --- |\n| 내용 | 내용 | 내용 |"),
  "block-math": (text, from, to) => insertMarkdownBlock(text, from, to, "$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$"),
  mermaid: (text, from, to) => insertMarkdownBlock(text, from, to, "```mermaid\nflowchart LR\n  A[시작] --> B[완료]\n```"),
  rule: (text, from, to) => insertMarkdownBlock(text, from, to, "---"),
};

function commandFor(action: string): MarkdownCommand | null {
  const heading = /^heading-([1-6])$/.exec(action);
  if (heading) return (text, from, to) => toggleHeadingMarkdown(text, from, to, Number(heading[1]));
  return COMMANDS[action] ?? null;
}

interface ToolbarAction {
  action: string;
  label: string;
  icon: EditorIconName;
  shortcut?: string;
  state?: keyof MarkdownFormatState;
}

const INLINE_ACTIONS: readonly ToolbarAction[] = [
  { action: "bold", label: "굵게", icon: "bold", shortcut: "Mod-B", state: "bold" },
  { action: "italic", label: "기울임", icon: "italic", shortcut: "Mod-I", state: "italic" },
  { action: "strike", label: "취소선", icon: "strike", shortcut: "Mod-Shift-X", state: "strike" },
  { action: "inline-code", label: "인라인 코드", icon: "inline-code", shortcut: "Mod-E", state: "code" },
  { action: "link", label: "링크", icon: "link", shortcut: "Mod-K", state: "link" },
];

const BLOCK_ACTIONS: readonly ToolbarAction[] = [
  { action: "bullet", label: "글머리 목록", icon: "bullet", shortcut: "Mod-Shift-8", state: "bullet" },
  { action: "ordered", label: "번호 목록", icon: "ordered", shortcut: "Mod-Shift-7", state: "ordered" },
  { action: "task", label: "체크리스트", icon: "task", shortcut: "Mod-Shift-9", state: "task" },
  { action: "quote", label: "인용", icon: "quote", state: "quote" },
  { action: "code-block", label: "코드 블록", icon: "code-block", state: "codeBlock" },
];

const INSERT_MENU_ITEMS = [
  { action: "table", label: "표", icon: "table", hint: "셀을 바로 편집하는 표" },
  { action: "image", label: "이미지", icon: "image", hint: "붙여넣기·끌어놓기도 됩니다" },
  { action: "block-math", label: "블록 수식", icon: "block-math", hint: "KaTeX $$ … $$" },
  { action: "inline-math", label: "인라인 수식", icon: "inline-math", hint: "문장 안의 $x$" },
  { action: "mermaid", label: "Mermaid 다이어그램", icon: "mermaid", hint: "흐름도·시퀀스 다이어그램" },
  { action: "rule", label: "구분선", icon: "rule", hint: "문단 사이 가로줄" },
] as const satisfies readonly (EditorMenuItem & { icon: EditorIconName })[];

const VIEW_OPTIONS = [
  { value: "glossary", label: "서식 편집", icon: "view-glossary", hint: "서식이 적용된 모습으로 편집" },
  { value: "text", label: "텍스트", icon: "view-text", hint: "Markdown 원문 텍스트 편집" },
  { value: "preview", label: "미리보기", icon: "view-preview", hint: "저장 후 보일 모습 미리보기" },
] as const satisfies readonly { value: MarkdownView; label: string; icon: EditorIconName; hint: string }[];

const KEY_BINDINGS: ReadonlyArray<{ key: string; action: string }> = [
  ...INLINE_ACTIONS.concat(BLOCK_ACTIONS).filter((item) => item.shortcut).map((item) => ({ key: item.shortcut!, action: item.action })),
  { key: "Mod-Alt-0", action: "paragraph" },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-Alt-${level}`, action: `heading-${level}` })),
];

function shortcutLabel(shortcut: string | undefined, mac: boolean): string | undefined {
  if (!shortcut) return undefined;
  const parts = shortcut.split("-").map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    return part.toUpperCase();
  });
  return parts.join(mac ? "" : "+");
}

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * basicSetup의 defaultHighlightStyle은 Markdown 제목에 밑줄을 긋는다. 서식 편집에서는
 * 커서가 있는 제목 줄이 원문으로 돌아오는 순간 밑줄이 생겼다 사라져 링크처럼 보였다.
 * 렌더링 결과(.markdown-body)와 어긋나지 않는 스타일을 직접 정의한다.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "rgb(var(--ink))" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "rgb(var(--brand))" },
  { tag: tags.monospace, fontFamily: MONO_FONT, fontSize: "0.92em" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.labelName], color: "rgb(var(--ink-3))" },
  { tag: tags.quote, color: "rgb(var(--ink-2))" },
]);

const KOREAN_PHRASES = EditorState.phrases.of({
  Find: "찾기",
  Replace: "바꿀 내용",
  next: "다음",
  previous: "이전",
  all: "모두 선택",
  "match case": "대소문자 구분",
  regexp: "정규식",
  "by word": "단어 단위",
  replace: "바꾸기",
  "replace all": "모두 바꾸기",
  close: "닫기",
  "current match": "현재 항목",
  "replaced $ matches": "$개를 바꿨습니다",
  "replaced match on line $": "$번째 줄을 바꿨습니다",
  "on line": "줄",
  "Go to line": "줄로 이동",
  go: "이동",
});

function maxLengthExtension(limit: number | undefined) {
  return limit === undefined
    ? []
    : EditorState.changeFilter.of((transaction) => !transaction.docChanged || transaction.newDoc.length <= limit);
}

function editorContentAttributes(label: string, name: string | undefined, describedBy: string | undefined, invalid: boolean) {
  return EditorView.contentAttributes.of({
    "aria-label": label,
    ...(name ? { "data-field-name": name } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(invalid ? { "aria-invalid": "true" } : {}),
  });
}

function modeExtension(mode: EditMode) {
  return mode === "glossary"
    ? [livePreviewExtension, EditorView.editorAttributes.of({ class: "cm-mode-glossary" })]
    : [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), EditorView.editorAttributes.of({ class: "cm-mode-text" })];
}

function applyCommand(view: EditorView, command: MarkdownCommand) {
  const source = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const edit = command(source, from, to);
  view.dispatch({
    changes: { from: 0, to: source.length, insert: edit.text },
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
}

function formatStateOf(state: EditorState): MarkdownFormatState {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  let inCodeBlock = false;
  for (let node = syntaxTree(state).resolveInner(from, 1); ; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      inCodeBlock = true;
      break;
    }
    if (!node.parent) break;
  }
  return markdownFormatState(line.text, from - line.from, Math.min(to, line.to) - line.from, inCodeBlock);
}

const SIZE_LEVELS = [500, 640, 780] as const;

export function MarkdownEditor({
  name,
  label = "Markdown 본문",
  describedBy,
  invalid = false,
  value,
  onChange,
  disabled = false,
  maxLength,
  compact = false,
  resizable = false,
  fillAvailable = false,
  defaultView = "glossary",
  embedded = false,
  onUploadingChange,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const maxLengthRef = useRef(maxLength);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const attributesCompartmentRef = useRef(new Compartment());
  const maxLengthCompartmentRef = useRef(new Compartment());
  const livePreviewCompartmentRef = useRef(new Compartment());
  const uploadSequenceRef = useRef(0);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mode, setMode] = useState<MarkdownView>(defaultView);
  const [fullscreen, setFullscreen] = useState(false);
  const [format, setFormat] = useState<MarkdownFormatState>(EMPTY_FORMAT_STATE);
  const [sizeLevel, setSizeLevel] = useState<number>(SIZE_LEVELS.length);
  const [dragging, setDragging] = useState(false);
  const [mac, setMac] = useState(false);
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const lastEditModeRef = useRef<EditMode>(defaultView === "preview" ? "glossary" : defaultView);
  const pendingCommandRef = useRef<MarkdownCommand | null>(null);
  const runActionRef = useRef<(action: string) => void>(() => {});
  const formatRef = useRef(format);
  const dragDepthRef = useRef(0);

  onChangeRef.current = onChange;
  disabledRef.current = disabled;
  maxLengthRef.current = maxLength;
  if (mode !== "preview") lastEditModeRef.current = mode;

  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  }, []);

  // 툴바 배치는 화면 폭이 아니라 편집기 폭으로 정한다. 위키 편집은 넓고 용어 편집은
  // 옆 설정 패널 때문에 좁다. 숨긴 도구는 "더보기"에 정확히 그만큼만 담아야 해서
  // CSS container query 대신 React 상태로 둔다.
  useEffect(() => {
    const root = fullscreenRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setSizeLevel(SIZE_LEVELS.filter((threshold) => width >= threshold).length);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // 부모 상태 변경은 React가 state updater를 평가하는 도중이 아니라 commit 뒤에
  // 전달한다. setUploadCount((count) => ...) 안에서 onUploadingChange를 호출하면
  // MarkdownEditor 렌더 중 TermForm을 갱신하는 것으로 판정된다.
  useEffect(() => {
    onUploadingChange?.(uploadCount > 0);
  }, [onUploadingChange, uploadCount]);

  useEffect(() => {
    viewRef.current?.requestMeasure();
    if (!fullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fullscreenButtonRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const controls = Array.from(fullscreenRootRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"], [contenteditable="true"]',
        ) ?? []).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      // `/` 메뉴·검색 패널·툴바 메뉴가 Esc를 먼저 처리했으면 전체 화면까지 닫지 않는다.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      fullscreenButtonRef.current?.focus({ preventScroll: true });
    };
  }, [fullscreen]);

  function insertText(text: string, from?: number, to?: number) {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: from ?? selection.from, to: to ?? selection.to, insert: text },
      selection: { anchor: (from ?? selection.from) + text.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  /**
   * 예전에는 툴바 명령마다 setMode("text")를 불러, 서식 편집 중 "굵게"만 눌러도 원문
   * 텍스트 화면으로 튕겨 나갔다. 편집기가 숨어 있는 미리보기에서만 마지막 편집 방식으로
   * 돌아가고, 명령은 편집기가 다시 보인 뒤에 적용한다(숨은 편집기는 focus를 받지 못한다).
   */
  function run(command: MarkdownCommand) {
    if (disabled) return;
    const view = viewRef.current;
    if (!view) return;
    if (mode === "preview") {
      pendingCommandRef.current = command;
      setMode(lastEditModeRef.current);
      return;
    }
    applyCommand(view, command);
  }

  function replaceUploadMarker(marker: string, replacement: string) {
    const view = viewRef.current;
    if (!view) return false;
    const source = view.state.doc.toString();
    const from = source.indexOf(marker);
    if (from < 0) return false;
    const limit = maxLengthRef.current;
    if (limit !== undefined && source.length - marker.length + replacement.length > limit) {
      view.dispatch({ changes: { from, to: from + marker.length, insert: "" } });
      setUploadError(`이미지를 넣으면 최대 ${limit.toLocaleString()}자를 초과합니다.`);
      return false;
    }
    view.dispatch({ changes: { from, to: from + marker.length, insert: replacement } });
    return true;
  }

  async function upload(files: File[]) {
    if (disabledRef.current || files.length === 0) return;
    setUploadError(null);
    const markers = files.map(() => `<!-- glossary-image-upload-${Date.now()}-${uploadSequenceRef.current++} -->`);
    const markerBlock = `\n${markers.join("\n")}\n`;
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const nextLength = view.state.doc.length - (selection.to - selection.from) + markerBlock.length;
    const limit = maxLengthRef.current;
    if (limit !== undefined && nextLength > limit) {
      setUploadError(`이미지를 넣으면 최대 ${limit.toLocaleString()}자를 초과합니다.`);
      return;
    }
    setUploadCount((count) => count + files.length);
    insertText(markerBlock);

    await Promise.all(files.map(async (file, index) => {
      const marker = markers[index]!;
      try {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/v1/attachments", { method: "POST", body });
        const result = await response.json().catch(() => null) as (UploadResponse & { error?: { message?: string } }) | null;
        if (!response.ok || !result?.url) throw new Error(result?.error?.message || "이미지를 업로드하지 못했습니다.");
        const sizedUrl = `${result.url}?width=${result.width}&height=${result.height}`;
        replaceUploadMarker(marker, `![${imageAlt(file)}](${sizedUrl})`);
      } catch (error) {
        replaceUploadMarker(marker, "");
        setUploadError(error instanceof Error ? error.message : "이미지를 업로드하지 못했습니다.");
      } finally {
        setUploadCount((count) => count - 1);
      }
    }));
  }

  function slashCompletions(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const slash = slashCommandQuery(line.text.slice(0, context.pos - line.from));
    if (!slash) return null;
    if (formatStateOf(context.state).codeBlock) return null;
    const options = matchSlashCommands(slash.query);
    if (options.length === 0) return null;
    return {
      from: line.from + slash.offset,
      filter: false,
      options: options.map((command, index) => ({
        label: command.label,
        detail: command.hint,
        boost: -index,
        apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
          view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
          runActionRef.current(command.action);
        },
      })),
    };
  }

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(markdownHighlight),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          tooltips({ parent: document.body }),
          autocompletion({ override: [slashCompletions], icons: false, closeOnBlur: true, tooltipClass: () => "cm-slash-menu" }),
          placeholder("내용을 입력하세요. 줄 맨 앞에서 / 를 누르면 표·목록·수식을 넣을 수 있습니다."),
          KOREAN_PHRASES,
          Prec.highest(keymap.of([
            ...KEY_BINDINGS.map(({ key, action }) => ({
              key,
              preventDefault: true,
              run: (target: EditorView) => {
                if (disabledRef.current) return false;
                const command = commandFor(action);
                if (!command) return false;
                applyCommand(target, command);
                return true;
              },
            })),
            {
              key: "Tab",
              run: (target: EditorView) => indentList(target, 1),
              shift: (target: EditorView) => indentList(target, -1),
            },
          ])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
          markdown(),
          EditorView.lineWrapping,
          attributesCompartmentRef.current.of(editorContentAttributes(label, name, describedBy, invalid)),
          readOnlyCompartmentRef.current.of(EditorState.readOnly.of(disabled)),
          maxLengthCompartmentRef.current.of(maxLengthExtension(maxLength)),
          livePreviewCompartmentRef.current.of(modeExtension(mode === "preview" ? lastEditModeRef.current : mode)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              const next = formatStateOf(update.state);
              if (!sameFormatState(next, formatRef.current)) {
                formatRef.current = next;
                setFormat(next);
              }
            }
          }),
          EditorView.domEventHandlers({
            paste(event, target) {
              if (disabledRef.current) return false;
              const files = imageFiles(Array.from(event.clipboardData?.files ?? []));
              if (files.length > 0) {
                event.preventDefault();
                void upload(files);
                return true;
              }
              const { from, to } = target.state.selection.main;
              const edit = pasteLinkMarkdown(target.state.doc.toString(), from, to, event.clipboardData?.getData("text/plain") ?? "");
              if (!edit) return false;
              event.preventDefault();
              target.dispatch({
                changes: { from: 0, to: target.state.doc.length, insert: edit.text },
                selection: { anchor: edit.anchor, head: edit.head },
                userEvent: "input.paste",
              });
              return true;
            },
            drop(event, target) {
              if (disabledRef.current) return false;
              const files = imageFiles(Array.from(event.dataTransfer?.files ?? []));
              if (files.length === 0) return false;
              event.preventDefault();
              const position = target.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position !== null) target.dispatch({ selection: { anchor: position } });
              void upload(files);
              return true;
            },
          }),
          EditorView.theme({
            ".cm-live-heading-1": { fontSize: "1.5rem", fontWeight: "700", lineHeight: "1.45", letterSpacing: "-0.02em" },
            ".cm-live-heading-2": { fontSize: "1.25rem", fontWeight: "700", lineHeight: "1.5", letterSpacing: "-0.015em" },
            ".cm-live-heading-3": { fontSize: "1.125rem", fontWeight: "700", lineHeight: "1.55" },
            ".cm-live-heading-4": { fontSize: "1rem", fontWeight: "700" },
            ".cm-live-heading-5": { fontSize: "0.875rem", fontWeight: "700" },
            ".cm-live-heading-6": { fontSize: "0.8rem", fontWeight: "700", color: "rgb(var(--ink-2))", letterSpacing: "0.02em" },
            ".cm-live-quote": { color: "rgb(var(--ink-2))" },
            ".cm-live-list-marker, .cm-live-task-marker": { color: "rgb(var(--brand))", display: "inline-block", minWidth: "1.25rem" },
            ".cm-live-inline-code": { backgroundColor: "rgb(var(--panel-2))", border: "1px solid rgb(var(--line))", borderRadius: "0.3rem", fontFamily: MONO_FONT, fontSize: "0.88em", padding: "0.05rem 0.3rem" },
            ".cm-live-strong": { fontWeight: "700" },
            ".cm-live-emphasis": { fontStyle: "italic" },
            ".cm-live-strike": { textDecoration: "line-through", textDecorationColor: "rgb(var(--ink-3))" },
            ".cm-live-link": { color: "rgb(var(--brand))", textDecoration: "underline", textDecorationColor: "rgb(var(--brand) / 0.4)", textUnderlineOffset: "0.2em" },
            ".cm-live-image": { color: "rgb(var(--ink-3))", fontStyle: "italic" },
            ".cm-live-preview-image": { border: "1px solid rgb(var(--line))", borderRadius: "0.5rem", display: "inline-block", height: "auto", margin: "0.5rem 0", maxHeight: "70vh", maxWidth: "100%", objectFit: "contain", verticalAlign: "middle" },
            ".cm-lineNumbers .cm-live-preview-line-number": { display: "block", paddingTop: "0.25rem" },
            ".cm-live-math": { color: "rgb(var(--info))", fontFamily: MONO_FONT },
            // 표·수식 위젯처럼 본문 여백 안쪽에 블록을 놓는다. 가로 margin은 줄 높이 측정에 영향이 없다.
            ".cm-live-code-line": { backgroundColor: "rgb(var(--panel-2))", fontFamily: MONO_FONT, fontSize: "13px", marginLeft: "var(--md-pad-x)", marginRight: "var(--md-pad-x)", paddingLeft: "1rem !important", paddingRight: "1rem !important" },
            ".cm-live-quote-line": { backgroundColor: "rgb(var(--brand-soft))", borderRadius: "0 0.375rem 0.375rem 0", boxShadow: "inset 3px 0 0 0 rgb(var(--brand) / 0.45)", marginLeft: "var(--md-pad-x)", marginRight: "var(--md-pad-x)", paddingLeft: "1rem !important" },
            ".cm-live-code-start": { borderTopLeftRadius: "0.5rem", borderTopRightRadius: "0.5rem", paddingTop: "0.25rem" },
            ".cm-live-code-end": { borderBottomLeftRadius: "0.5rem", borderBottomRightRadius: "0.5rem", paddingBottom: "0.25rem" },
            ".cm-live-code-block": { fontFamily: MONO_FONT },
            ".cm-live-code-fence": { color: "rgb(var(--ink-3))", fontFamily: "inherit", fontSize: "11px", fontStyle: "normal", fontWeight: "500", letterSpacing: "0.02em" },
            ".cm-live-upload": { alignItems: "center", backgroundColor: "rgb(var(--panel-2))", border: "1px dashed rgb(var(--line-strong))", borderRadius: "0.5rem", color: "rgb(var(--ink-3))", display: "inline-flex", fontSize: "0.8rem", gap: "0.4rem", margin: "0.25rem 0", padding: "0.35rem 0.75rem" },
            ".cm-live-horizontal-rule": { borderTop: "1px solid rgb(var(--line))", display: "inline-block", height: "1px", verticalAlign: "middle", width: "100%" },
            ".cm-live-preview-block": { boxSizing: "border-box", cursor: "text", display: "block", paddingLeft: "var(--md-pad-x)", paddingRight: "var(--md-pad-x)", position: "relative", width: "100%" },
            ".cm-live-preview-block-inner": { position: "relative", width: "100%" },
            ".cm-live-preview-edit": { alignItems: "center", backgroundColor: "rgb(var(--panel) / 0.95)", border: "1px solid rgb(var(--line))", borderRadius: "0.375rem", boxShadow: "0 1px 2px rgb(0 0 0 / 0.06)", color: "rgb(var(--ink-2))", display: "flex", fontFamily: MONO_FONT, fontSize: "0.75rem", height: "1.5rem", justifyContent: "center", opacity: "0", padding: "0 0.4rem", pointerEvents: "none", position: "absolute", right: "0.35rem", top: "0.35rem", transition: "background-color 120ms ease, color 120ms ease, opacity 120ms ease", zIndex: "4" },
            ".cm-live-preview-block:hover .cm-live-preview-edit, .cm-live-preview-edit:focus-visible": { opacity: "1", pointerEvents: "auto" },
            ".cm-live-preview-edit:hover": { backgroundColor: "rgb(var(--brand) / 0.12)", color: "rgb(var(--brand))" },
            ".cm-live-preview-block[data-live-preview-block=math]:hover, .cm-live-preview-block[data-live-preview-block=mermaid]:hover": { backgroundColor: "rgb(var(--panel-2) / 0.6)" },
            ".cm-live-preview-add-paragraph": { alignItems: "center", backgroundColor: "transparent", border: "0", borderTop: "1px solid rgb(var(--line))", borderRadius: "0.375rem", color: "rgb(var(--brand))", display: "flex", fontSize: "0.875rem", height: "1.25rem", justifyContent: "center", margin: "0.1rem 0 0", opacity: "0", padding: "0 0.75rem", pointerEvents: "none", transition: "background-color 120ms ease, opacity 120ms ease" },
            ".cm-live-preview-block:hover .cm-live-preview-add-paragraph, .cm-live-preview-add-paragraph:focus-visible": { opacity: "1", pointerEvents: "auto" },
            ".cm-live-preview-add-paragraph:hover": { backgroundColor: "rgb(var(--brand) / 0.08)" },
            ".cm-live-preview-block-content": { width: "100%" },
            ".cm-live-preview-block-content a": { pointerEvents: "none" },
            ".cm-live-preview-block-content .mermaid-diagram": { marginBottom: "0", marginTop: "0" },
            ".cm-live-preview-block-content .katex-display": { marginBottom: "0", marginTop: "0" },
            ".cm-live-preview-block-content.cm-live-table-shell": { marginBottom: "0", marginTop: "0" },
            ".cm-live-table-shell": { display: "inline-block", marginBottom: "0.5rem", marginTop: "0.5rem", maxWidth: "100%", position: "relative", verticalAlign: "top", width: "fit-content" },
            ".cm-live-table-scroll": { display: "inline-block", maxWidth: "100%", overflow: "visible", position: "relative", verticalAlign: "top", width: "fit-content" },
            ".markdown-body .cm-live-table": { marginBottom: "0", marginTop: "0", minWidth: "0", tableLayout: "auto", width: "max-content" },
            ".cm-live-table th:not(.cm-live-table-control-column)": { cursor: "default", userSelect: "none" },
            ".cm-live-table th:not(.cm-live-table-control-column):active": { cursor: "default" },
            ".cm-live-table-control-column": { backgroundColor: "transparent", border: "none", minWidth: "0", overflow: "visible", padding: "0", width: "0" },
            ".cm-live-table-column-header": { position: "relative" },
            ".cm-live-table-column-handle": { alignItems: "center", backgroundColor: "rgb(var(--brand))", border: "0", borderRadius: "0.375rem", boxShadow: "0 1px 3px rgb(0 0 0 / 0.16)", color: "white", cursor: "grab", display: "flex", fontSize: "0.75rem", height: "1.5rem", justifyContent: "center", left: "50%", minWidth: "2.25rem", opacity: "0", padding: "0", pointerEvents: "none", position: "absolute", top: "-1.5rem", transform: "translateX(-50%)", transition: "opacity 120ms ease", width: "calc(100% - 0.5rem)", zIndex: "3" },
            ".cm-live-table-column-header:hover .cm-live-table-column-handle, .cm-live-table-column-dragging .cm-live-table-column-handle, .cm-live-table-column-handle:focus-visible": { opacity: "1", pointerEvents: "auto" },
            ".cm-live-table-cell-input": { backgroundColor: "transparent", border: "0", boxSizing: "border-box", color: "inherit", display: "block", font: "inherit", lineHeight: "inherit", margin: "0", minWidth: "0", outline: "none", padding: "0", width: "100%" },
            ".cm-live-table-cell-input::placeholder": { color: "rgb(var(--ink-3))", opacity: "0.8" },
            ".cm-live-table-cell-input:focus": { backgroundColor: "rgb(var(--brand) / 0.06)", borderRadius: "0.2rem", boxShadow: "inset 0 0 0 2px rgb(var(--brand))" },
            ".cm-live-table-row-handle-cell": { position: "relative" },
            ".cm-live-table-row-handle": { alignItems: "center", backgroundColor: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: "0.375rem", color: "rgb(var(--ink-3))", cursor: "grab", display: "flex", height: "2rem", justifyContent: "center", opacity: "0", padding: "0", position: "absolute", right: "0", top: "50%", transform: "translateY(-50%)", transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease", width: "1.5rem", zIndex: "3" },
            ".cm-live-table-row-handle:active": { cursor: "grabbing" },
            ".cm-live-table-row:hover .cm-live-table-row-handle, .cm-live-table-row:focus-within .cm-live-table-row-handle": { opacity: "1" },
            ".cm-live-table-row-handle:hover": { backgroundColor: "rgb(var(--panel-2))", borderColor: "rgb(var(--brand) / 0.5)", color: "rgb(var(--brand))" },
            ".cm-live-table-row-handle-active": { backgroundColor: "rgb(var(--brand))", borderColor: "rgb(var(--brand))", color: "white", opacity: "1" },
            ".cm-live-table-drop-target": { backgroundColor: "transparent" },
            ".cm-live-table-column-drop-before": { boxShadow: "inset 3px 0 0 0 rgb(var(--brand))" },
            ".cm-live-table-column-drop-after": { boxShadow: "inset -3px 0 0 0 rgb(var(--brand))" },
            ".cm-live-table-row-drop-before > td:not(.cm-live-table-control-column)": { backgroundColor: "rgb(var(--brand) / 0.08)", boxShadow: "inset 0 3px 0 0 rgb(var(--brand))" },
            ".cm-live-table-row-drop-after > td:not(.cm-live-table-control-column)": { backgroundColor: "rgb(var(--brand) / 0.08)", boxShadow: "inset 0 -3px 0 0 rgb(var(--brand))" },
            ".cm-live-table-add-column": { alignItems: "center", backgroundColor: "transparent", border: "0", borderRadius: "0.375rem", color: "rgb(var(--brand))", display: "flex", height: "auto", justifyContent: "center", opacity: "0", padding: "0", pointerEvents: "none", position: "absolute", right: "-1.5rem", top: "0.25rem", bottom: "0.25rem", transition: "background-color 120ms ease, opacity 120ms ease", width: "1.5rem", zIndex: "2" },
            ".cm-live-table-shell:hover .cm-live-table-add-column, .cm-live-table-add-column:focus-visible": { opacity: "1", pointerEvents: "auto" },
            ".cm-live-table-add-column:hover, .cm-live-table-add-column:focus-visible": { backgroundColor: "rgb(var(--brand) / 0.08)" },
            ".cm-live-table-add-row": { backgroundColor: "transparent", border: "0", borderRadius: "0.375rem", borderTop: "1px solid rgb(var(--line))", color: "rgb(var(--brand))", display: "block", fontSize: "1rem", height: "1.25rem", lineHeight: "1", margin: "0", minHeight: "1.25rem", padding: "0", transition: "background-color 120ms ease", width: "100%" },
            ".cm-live-table-add-row:hover, .cm-live-table-add-row:focus-visible": { backgroundColor: "rgb(var(--brand) / 0.08)" },
            ".cm-live-table-fallback": { margin: "0", whiteSpace: "pre-wrap" },
          }),
          EditorView.theme({
            "&": { "--md-pad-x": compact ? "1rem" : "1.5rem", height: resizable ? "100%" : "auto", minHeight: resizable ? "0" : compact ? "10rem" : "16rem", backgroundColor: "transparent", color: "rgb(var(--ink))" },
            ".cm-scroller": { overflow: "auto", fontFamily: '"Pretendard Variable", Pretendard, sans-serif' },
            ".cm-content": {
              minHeight: resizable ? "100%" : compact ? "10rem" : "16rem",
              boxSizing: "border-box",
              padding: compact ? "0.875rem 0 2rem" : "1.25rem 0 3rem",
              caretColor: "rgb(var(--brand))",
              fontFamily: '"Pretendard Variable", Pretendard, sans-serif',
              fontSize: "15px",
              lineHeight: "1.8",
              letterSpacing: "-0.012em",
            },
            ".cm-line": { paddingLeft: "var(--md-pad-x)", paddingRight: "var(--md-pad-x)" },
            "&.cm-mode-text .cm-line": { paddingLeft: "0.75rem" },
            ".cm-placeholder": { color: "rgb(var(--ink-3))" },
            ".cm-gutters": { backgroundColor: "rgb(var(--panel-2) / 0.6)", color: "rgb(var(--ink-3))", border: "none", borderRight: "1px solid rgb(var(--line))", fontSize: "12px" },
            ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.25rem", padding: "0 0.5rem 0 0.75rem" },
            ".cm-activeLine": { backgroundColor: "rgb(var(--brand) / 0.04)" },
            ".cm-activeLineGutter": { backgroundColor: "transparent", color: "rgb(var(--ink))" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgb(var(--selection) / 0.22)" },
            ".cm-selectionMatch": { backgroundColor: "rgb(var(--warn) / 0.18)" },
            ".cm-cursor": { borderLeftColor: "rgb(var(--brand))", borderLeftWidth: "2px" },
            // 포커스 표시는 셸 테두리가 맡는다(globals.css의 .markdown-editor-shell:has(.cm-focused)).
            // 편집 영역 안쪽에 링을 그리면 툴바와 상태 표시줄은 빠진 채 가운데만 테두리가 생겼다.
            "&.cm-focused": { boxShadow: "none", outline: "none" },
            ".cm-panels": { backgroundColor: "rgb(var(--panel-2))", color: "rgb(var(--ink))", borderColor: "rgb(var(--line))" },
            ".cm-panels.cm-panels-top": { borderBottom: "1px solid rgb(var(--line))" },
            ".cm-search": { alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "0.375rem", padding: "0.5rem 2.25rem 0.5rem 0.75rem" },
            ".cm-search br": { display: "none" },
            ".cm-search label": { alignItems: "center", color: "rgb(var(--ink-2))", display: "inline-flex", gap: "0.25rem" },
            ".cm-textfield": { backgroundColor: "rgb(var(--panel))", border: "1px solid rgb(var(--line-strong))", borderRadius: "0.375rem", color: "rgb(var(--ink))", fontSize: "12px", height: "1.75rem", margin: "0", padding: "0 0.5rem" },
            ".cm-textfield:focus": { borderColor: "rgb(var(--brand))", outline: "2px solid rgb(var(--brand) / 0.2)" },
            ".cm-button": { backgroundColor: "rgb(var(--panel))", backgroundImage: "none", border: "1px solid rgb(var(--line))", borderRadius: "0.375rem", color: "rgb(var(--ink-2))", fontSize: "12px", height: "1.75rem", margin: "0", padding: "0 0.6rem" },
            ".cm-button:hover": { backgroundColor: "rgb(var(--panel-2))", color: "rgb(var(--ink))" },
            ".cm-panel button[name=close]": { color: "rgb(var(--ink-3))", fontSize: "18px", right: "0.6rem", top: "0.45rem" },
            ".cm-tooltip": { zIndex: "130" },
            ".cm-tooltip.cm-tooltip-autocomplete": { backgroundColor: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: "0.75rem", boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.28), 0 2px 6px -2px rgb(0 0 0 / 0.12)", overflow: "hidden", padding: "0.375rem" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: '"Pretendard Variable", Pretendard, sans-serif', maxHeight: "18rem", minWidth: "15rem" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { alignItems: "center", borderRadius: "0.5rem", color: "rgb(var(--ink))", display: "flex", fontSize: "13px", gap: "0.75rem", lineHeight: "1.4", padding: "0.4rem 0.6rem" },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgb(var(--brand-soft))", color: "rgb(var(--brand))" },
            ".cm-completionLabel": { flex: "1" },
            ".cm-completionDetail": { color: "rgb(var(--ink-3))", fontFamily: MONO_FONT, fontSize: "11px", fontStyle: "normal", marginLeft: "auto" },
            ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
            ".cm-searchMatch": { backgroundColor: "rgb(var(--warn) / 0.22)", borderRadius: "2px" },
            ".cm-searchMatch-selected": { backgroundColor: "rgb(var(--warn) / 0.45)" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    formatRef.current = formatStateOf(view.state);
    setFormat(formatRef.current);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compact, resizable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // 미리보기 동안에는 편집기가 숨어 있으므로 마지막 편집 방식을 유지한다.
    view.dispatch({ effects: livePreviewCompartmentRef.current.reconfigure(modeExtension(mode === "preview" ? lastEditModeRef.current : mode)) });
    view.requestMeasure();
    const pending = pendingCommandRef.current;
    if (mode !== "preview" && pending) {
      pendingCommandRef.current = null;
      applyCommand(view, pending);
    }
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(disabled)) });
  }, [disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: attributesCompartmentRef.current.reconfigure(editorContentAttributes(label, name, describedBy, invalid)) });
  }, [describedBy, invalid, label, name]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: maxLengthCompartmentRef.current.reconfigure(maxLengthExtension(maxLength)) });
  }, [maxLength]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  function indentList(target: EditorView, direction: 1 | -1) {
    if (disabledRef.current) return false;
    const { from, to } = target.state.selection.main;
    const edit = indentListMarkdown(target.state.doc.toString(), from, to, direction);
    if (!edit) return false;
    target.dispatch({
      changes: { from: 0, to: target.state.doc.length, insert: edit.text },
      selection: { anchor: edit.anchor, head: edit.head },
      userEvent: "input.indent",
    });
    return true;
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    void upload(imageFiles(Array.from(event.target.files ?? [])));
    event.target.value = "";
  }

  function runToolbarAction(action: string) {
    if (disabled) return;
    if (action === "image") {
      if (uploadCount > 0) return;
      if (mode === "preview") setMode(lastEditModeRef.current);
      fileRef.current?.click();
      return;
    }
    const command = commandFor(action);
    if (command) run(command);
  }
  runActionRef.current = runToolbarAction;

  function moveToolbarFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    if (!(event.target instanceof HTMLButtonElement)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"))
      .filter((button) => button.getClientRects().length > 0);
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function hasFiles(event: DragEvent) {
    return !disabled && mode !== "preview" && Array.from(event.dataTransfer.types).includes("Files");
  }

  const showBlockGroup = sizeLevel >= 3;
  const showInlineGroup = sizeLevel >= 1;
  const showViewLabels = sizeLevel >= 2;
  const overflowActions = [...(showInlineGroup ? [] : INLINE_ACTIONS), ...(showBlockGroup ? [] : BLOCK_ACTIONS)];
  const blockLabel = format.codeBlock ? "코드 블록" : format.heading ? `제목 ${format.heading}` : "본문";
  const nearLimit = maxLength !== undefined && value.length >= maxLength * 0.9;
  const atLimit = maxLength !== undefined && value.length >= maxLength;
  const toolbarButtonClass = "inline-flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      ref={fullscreenRootRef}
      data-markdown-fullscreen={fullscreen}
      data-embedded={embedded}
      data-invalid={invalid || undefined}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? `${label} 전체 화면 편집기` : undefined}
      className={cx("markdown-editor-shell", fullscreen
        ? "fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-panel"
        : cx(
          "overflow-hidden bg-panel",
          !embedded && "rounded-xl border border-line",
          "korean-editor-font",
          resizable && (fillAvailable
            ? "flex min-h-64 min-w-0 flex-1 flex-col resize-y"
            : "flex h-80 min-h-64 max-h-[75dvh] flex-col resize-y"),
        ))}
    >
      <div
        role="toolbar"
        aria-label="Markdown 서식 도구"
        aria-orientation="horizontal"
        onKeyDown={moveToolbarFocus}
        className="markdown-editor-toolbar flex min-w-0 shrink-0 items-center gap-1 border-b border-line bg-panel-2/70 px-2 py-1.5"
      >
        <EditorMenu
          label="블록 종류"
          title={`블록 종류: ${blockLabel}`}
          radio
          disabled={disabled}
          triggerClassName="inline-flex h-8 w-[6.25rem] shrink-0 items-center justify-between gap-1 rounded-md px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-40"
          trigger={<><span className="truncate">{blockLabel}</span><EditorIcon name="chevron" size={14} className="shrink-0 text-ink-3" /></>}
          onSelect={runToolbarAction}
          sections={[{
            items: [
              { action: "paragraph", label: "본문", shortcut: shortcutLabel("Mod-Alt-0", mac), checked: !format.heading && !format.codeBlock },
              ...[1, 2, 3, 4, 5, 6].map((level) => ({
                action: `heading-${level}`,
                label: `제목 ${level}`,
                shortcut: shortcutLabel(`Mod-Alt-${level}`, mac),
                checked: format.heading === level,
                labelClassName: ["text-xl font-bold", "text-lg font-bold", "text-base font-bold", "text-sm font-bold", "text-[13px] font-bold", "text-xs font-bold text-ink-2"][level - 1],
              })),
            ],
          }]}
        />

        <ToolbarDivider />

        {showInlineGroup && (
          <div className="markdown-toolbar-inline flex shrink-0 items-center gap-0.5" role="group" aria-label="글자 서식">
            {INLINE_ACTIONS.map((item) => (
              <ToolbarButton key={item.action} item={item} mac={mac} active={item.state ? Boolean(format[item.state]) : false} disabled={disabled} className={toolbarButtonClass} onClick={() => runToolbarAction(item.action)} />
            ))}
          </div>
        )}

        {showInlineGroup && showBlockGroup && <ToolbarDivider />}

        {showBlockGroup && (
          <div className="markdown-toolbar-blocks flex shrink-0 items-center gap-0.5" role="group" aria-label="문단 서식">
            {BLOCK_ACTIONS.map((item) => (
              <ToolbarButton key={item.action} item={item} mac={mac} active={item.state ? Boolean(format[item.state]) : false} disabled={disabled} className={toolbarButtonClass} onClick={() => runToolbarAction(item.action)} />
            ))}
          </div>
        )}

        {overflowActions.length > 0 && (
          <EditorMenu
            label="서식 더보기"
            disabled={disabled}
            triggerClassName={toolbarButtonClass}
            trigger={<EditorIcon name="more" />}
            pressed={overflowActions.some((item) => item.state && format[item.state])}
            onSelect={runToolbarAction}
            sections={[
              ...(showInlineGroup ? [] : [{ title: "글자 서식", items: INLINE_ACTIONS.map((item) => menuItemOf(item, format, mac)) }]),
              ...(showBlockGroup ? [] : [{ title: "문단 서식", items: BLOCK_ACTIONS.map((item) => menuItemOf(item, format, mac)) }]),
            ]}
          />
        )}

        <ToolbarDivider />

        <EditorMenu
          label="삽입"
          title="표·이미지·수식·다이어그램 삽입 (줄 맨 앞에서 / 입력)"
          disabled={disabled}
          triggerClassName="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-40"
          trigger={<><EditorIcon name="plus" /><span className={cx(!showViewLabels && "sr-only")}>삽입</span></>}
          onSelect={runToolbarAction}
          sections={[{ items: INSERT_MENU_ITEMS.map((item) => ({ ...item, disabled: item.action === "image" && uploadCount > 0 })) }]}
        />

        <div className="markdown-toolbar-view-segments ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="본문 보기 방식">
          {VIEW_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              aria-label={showViewLabels ? undefined : item.label}
              title={item.hint}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setMode(item.value)}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                showViewLabels ? "px-2.5" : "w-7 justify-center",
                mode === item.value ? "bg-brand-soft text-brand shadow-sm" : "text-ink-3 hover:bg-panel-2 hover:text-ink",
              )}
            >
              <EditorIcon name={item.icon} size={14} />
              {showViewLabels && item.label}
            </button>
          ))}
        </div>
        <button
          ref={fullscreenButtonRef}
          type="button"
          className={cx("markdown-toolbar-fullscreen", toolbarButtonClass)}
          aria-label={fullscreen ? "전체 화면 닫기" : "전체 화면"}
          aria-pressed={fullscreen}
          title={fullscreen ? "전체 화면 닫기 (Esc)" : "전체 화면으로 편집"}
          onClick={() => setFullscreen((current) => !current)}
        >
          <EditorIcon name={fullscreen ? "collapse" : "expand"} />
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={chooseFiles} />
      {uploadError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
          <span className="min-w-0 flex-1">{uploadError}</span>
          <button type="button" className="-my-0.5 shrink-0 rounded px-1 text-danger/80 hover:bg-danger/10 hover:text-danger" aria-label="오류 메시지 닫기" onClick={() => setUploadError(null)}>✕</button>
        </div>
      )}
      <div
        className={cx("relative grid", (fullscreen || resizable) && "min-h-0 flex-1")}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDropCapture={() => {
          dragDepthRef.current = 0;
          setDragging(false);
        }}
      >
        <div className={`${mode === "preview" ? "hidden" : "block"} h-full min-h-0 overflow-hidden`} aria-label={mode === "glossary" ? "서식 편집 Markdown 편집기" : "텍스트 Markdown 편집기"} ref={hostRef} />
        <div className={`${mode === "preview" ? "block" : "hidden"} ${resizable ? "min-h-0" : compact ? "min-h-40" : "min-h-[16rem]"} h-full overflow-auto ${compact ? "px-4 py-3.5" : "px-6 py-5"} ${fullscreen ? "min-h-0" : ""}`}>
          <div className="markdown-editor-preview">
            {value.trim()
              ? <MarkdownContent>{value}</MarkdownContent>
              : (
                <div className="grid h-full min-h-32 place-items-center text-center text-sm text-ink-3">
                  <div>
                    <EditorIcon name="view-preview" size={20} className="mx-auto mb-2 opacity-60" />
                    아직 작성한 내용이 없습니다.
                  </div>
                </div>
              )}
          </div>
        </div>
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-lg border-2 border-dashed border-brand/60 bg-brand-soft/80 text-sm font-medium text-brand" aria-hidden="true">
            <span className="inline-flex items-center gap-2"><EditorIcon name="upload" />이미지를 놓으면 커서 위치에 첨부합니다</span>
          </div>
        )}
      </div>
      <div className="markdown-editor-statusbar flex shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        <span className="min-w-0 truncate" aria-live="polite">
          {uploadCount > 0
            ? <span className="inline-flex items-center gap-1.5 text-brand"><span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-brand/30 border-t-brand" aria-hidden="true" />이미지 {uploadCount}개 업로드 중…</span>
            : mode === "preview"
              ? "미리보기 · 저장하면 이렇게 보입니다"
              : showViewLabels ? <>Markdown 지원 · 줄 맨 앞에서 <kbd className="rounded border border-line bg-panel-2 px-1 font-sans">/</kbd> 블록 삽입 · 이미지 붙여넣기·끌어놓기</> : <>줄 맨 앞 <kbd className="rounded border border-line bg-panel-2 px-1 font-sans">/</kbd> 블록 삽입</>}
        </span>
        <span className={cx("ml-auto shrink-0 tabular-nums", atLimit ? "font-medium text-danger" : nearLimit ? "text-warn" : undefined)}>
          {value.length.toLocaleString()}자{maxLength !== undefined && <> / {maxLength.toLocaleString()}</>}
        </span>
        {maxLength !== undefined && (
          <span className="sr-only" role="status" aria-live="polite">
            {nearLimit ? `${value.length.toLocaleString()} / ${maxLength.toLocaleString()}${value.length >= maxLength ? " · 최대 글자 수" : ""}` : ""}
          </span>
        )}
        {atLimit && <span className="shrink-0 font-medium text-danger" aria-hidden="true">최대 글자 수</span>}
      </div>
    </div>
  );

}

function menuItemOf(item: ToolbarAction, format: MarkdownFormatState, mac: boolean): EditorMenuItem {
  return {
    action: item.action,
    label: item.label,
    icon: item.icon,
    shortcut: shortcutLabel(item.shortcut, mac),
    hint: item.state && format[item.state] ? "적용됨 · 다시 누르면 해제" : undefined,
  };
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;
}

interface ToolbarButtonProps {
  item: ToolbarAction;
  mac: boolean;
  active: boolean;
  disabled: boolean;
  className: string;
  onClick: () => void;
}

function ToolbarButton({ item, mac, active, disabled, className, onClick }: ToolbarButtonProps): ReactNode {
  const shortcut = shortcutLabel(item.shortcut, mac);
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-pressed={item.state ? active : undefined}
      aria-keyshortcuts={item.shortcut?.replace("Mod", mac ? "Meta" : "Control").replaceAll("-", "+")}
      title={shortcut ? `${item.label} (${shortcut})` : item.label}
      disabled={disabled}
      // 버튼이 포커스를 가져가면 편집기의 선택 영역 표시가 사라졌다가 돌아오며 깜빡인다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cx(className, active && "!bg-brand-soft !text-brand")}
    >
      <EditorIcon name={item.icon} />
    </button>
  );
}
