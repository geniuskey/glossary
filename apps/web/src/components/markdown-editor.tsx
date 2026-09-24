"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { basicSetup, EditorView } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { livePreviewExtension } from "@/lib/markdown/live-preview";
import { cx } from "@/lib/ui/format";
import {
  insertMarkdownBlock,
  toggleCodeBlockMarkdown,
  toggleHeadingMarkdown,
  toggleListMarkdown,
  toggleQuoteMarkdown,
  wrapMarkdown,
  type MarkdownEdit,
} from "@/lib/markdown/edit";
import { MarkdownContent } from "./markdown-content";

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

function imageFiles(items: Iterable<File>): File[] {
  return [...items].filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
}

function imageAlt(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return (base || "첨부 이미지").replaceAll("]", "\\]");
}

type MarkdownCommand = (source: string, from: number, to: number) => MarkdownEdit;

const FORMAT_MENU_ITEMS = [
  { action: "bold", label: "굵게" },
  { action: "italic", label: "기울임" },
  { action: "strike", label: "취소선" },
  { action: "inline-code", label: "인라인 코드" },
  { action: "link", label: "링크" },
  { action: "inline-math", label: "인라인 수식" },
  { action: "quote", label: "인용" },
  { action: "bullet", label: "• 글머리" },
  { action: "ordered", label: "1. 번호" },
  { action: "task", label: "☑ 체크" },
  { action: "code-block", label: "코드 블록" },
] as const;

const INSERT_MENU_ITEMS = [
  { action: "table", label: "표" },
  { action: "block-math", label: "블록 수식" },
  { action: "mermaid", label: "Mermaid 다이어그램" },
  { action: "rule", label: "구분선" },
  { action: "image", label: "이미지" },
] as const;

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

function applyCommand(view: EditorView, command: MarkdownCommand) {
  const source = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const edit = command(source, from, to);
  view.dispatch({
    changes: { from: 0, to: source.length, insert: edit.text },
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
  });
  view.focus();
}

function handleMarkdownShortcut(event: KeyboardEvent, view: EditorView): boolean {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  let command: MarkdownCommand | null = null;

  if (mod && !event.altKey && !event.shiftKey && key === "b") command = (text, from, to) => wrapMarkdown(text, from, to, "**", "**", "굵은 텍스트");
  if (mod && !event.altKey && !event.shiftKey && key === "i") command = (text, from, to) => wrapMarkdown(text, from, to, "*", "*", "기울임 텍스트");
  if (mod && !event.altKey && !event.shiftKey && key === "k") command = (text, from, to) => wrapMarkdown(text, from, to, "[", "](https://example.com)", "링크 텍스트");
  if (mod && event.altKey && /^[1-6]$/.test(key)) {
    command = (text, from, to) => toggleHeadingMarkdown(text, from, to, Number(key));
  }
  if (!command) return false;

  event.preventDefault();
  applyCommand(view, command);
  return true;
}

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
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const viewSelectRef = useRef<HTMLSelectElement>(null);

  onChangeRef.current = onChange;
  disabledRef.current = disabled;
  maxLengthRef.current = maxLength;

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
    (fullscreenButtonRef.current?.getClientRects().length ? fullscreenButtonRef.current : viewSelectRef.current)?.focus({ preventScroll: true });
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      (fullscreenButtonRef.current?.getClientRects().length ? fullscreenButtonRef.current : viewSelectRef.current)?.focus({ preventScroll: true });
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

  function run(command: MarkdownCommand) {
    if (disabled) return;
    setMode("text");
    const view = viewRef.current;
    if (view) applyCommand(view, command);
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

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          attributesCompartmentRef.current.of(editorContentAttributes(label, name, describedBy, invalid)),
          readOnlyCompartmentRef.current.of(EditorState.readOnly.of(disabled)),
          maxLengthCompartmentRef.current.of(maxLengthExtension(maxLength)),
          livePreviewCompartmentRef.current.of(mode === "glossary" ? livePreviewExtension : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown(event, view) {
              if (disabledRef.current) return false;
              return handleMarkdownShortcut(event, view);
            },
            paste(event) {
              if (disabledRef.current) return false;
              const files = imageFiles(Array.from(event.clipboardData?.files ?? []));
              if (files.length === 0) return false;
              event.preventDefault();
              void upload(files);
              return true;
            },
            drop(event, view) {
              if (disabledRef.current) return false;
              const files = imageFiles(Array.from(event.dataTransfer?.files ?? []));
              if (files.length === 0) return false;
              event.preventDefault();
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position !== null) view.dispatch({ selection: { anchor: position } });
              void upload(files);
              return true;
            },
          }),
          EditorView.theme({
            ".cm-live-heading-1": { fontSize: "1.5rem", fontWeight: "700", lineHeight: "1.45" },
            ".cm-live-heading-2": { fontSize: "1.3rem", fontWeight: "700", lineHeight: "1.5" },
            ".cm-live-heading-3": { fontSize: "1.15rem", fontWeight: "700", lineHeight: "1.55" },
            ".cm-live-heading-4, .cm-live-heading-5, .cm-live-heading-6": { fontWeight: "700" },
            ".cm-live-quote": { borderLeft: "3px solid rgb(var(--brand) / 0.45)", color: "rgb(var(--ink-2))", fontStyle: "italic", paddingLeft: "0.75rem" },
            ".cm-live-list-marker, .cm-live-task-marker": { color: "rgb(var(--brand))", display: "inline-block", minWidth: "1.25rem" },
            ".cm-live-inline-code": { backgroundColor: "rgb(var(--panel-2))", borderRadius: "0.25rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", padding: "0.1rem 0.3rem" },
            ".cm-live-strong": { fontWeight: "700" },
            ".cm-live-emphasis": { fontStyle: "italic" },
            ".cm-live-strike": { textDecoration: "line-through", textDecorationColor: "rgb(var(--ink-3))" },
            ".cm-live-link": { color: "rgb(var(--brand))", textDecoration: "underline", textUnderlineOffset: "0.15em" },
            ".cm-live-image": { color: "rgb(var(--ink-3))", fontStyle: "italic" },
            ".cm-live-preview-image": { border: "1px solid rgb(var(--line))", borderRadius: "0.5rem", display: "inline-block", height: "auto", margin: "0.5rem 0", maxHeight: "70vh", maxWidth: "100%", objectFit: "contain", verticalAlign: "middle" },
            ".cm-lineNumbers .cm-live-preview-line-number": { display: "block", paddingTop: "0.25rem" },
            ".cm-live-math": { color: "rgb(var(--info))", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            ".cm-live-code-block": { backgroundColor: "rgb(var(--panel-2) / 0.75)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            ".cm-live-code-fence": { color: "rgb(var(--ink-3))", fontFamily: "inherit", fontSize: "0.8em", fontStyle: "normal" },
            ".cm-live-horizontal-rule": { borderTop: "1px solid rgb(var(--line))", display: "inline-block", height: "1px", verticalAlign: "middle", width: "100%" },
            ".cm-live-preview-block": { cursor: "text", display: "block", position: "relative", width: "100%" },
            ".cm-live-preview-block-inner": { position: "relative", width: "100%" },
            ".cm-live-preview-edit": { alignItems: "center", backgroundColor: "rgb(var(--panel-2) / 0.9)", border: "1px solid rgb(var(--line))", borderRadius: "0.375rem", color: "rgb(var(--ink-2))", display: "flex", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.75rem", height: "1.5rem", justifyContent: "center", opacity: "0", padding: "0 0.35rem", pointerEvents: "none", position: "absolute", right: "0.35rem", top: "0.35rem", transition: "background-color 120ms ease, color 120ms ease, opacity 120ms ease", zIndex: "4" },
            ".cm-live-preview-block:hover .cm-live-preview-edit, .cm-live-preview-edit:focus-visible": { opacity: "1", pointerEvents: "auto" },
            ".cm-live-preview-edit:hover": { backgroundColor: "rgb(var(--brand) / 0.12)", color: "rgb(var(--brand))" },
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
            "&": { height: resizable ? "100%" : "auto", minHeight: resizable ? "0" : compact ? "10rem" : "16rem", backgroundColor: "transparent", color: "rgb(var(--ink))" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              minHeight: resizable ? "100%" : compact ? "10rem" : "16rem",
              boxSizing: "border-box",
              padding: compact ? "0.75rem 0" : "1rem 0",
              caretColor: "rgb(var(--brand))",
              fontFamily: '"Noto Sans KR Variable", "Noto Sans KR", Pretendard, sans-serif',
              fontSize: "14px",
              lineHeight: "1.75",
              letterSpacing: "-0.012em",
            },
            ".cm-line": {
              paddingLeft: compact ? "calc(0.75rem + 6px)" : "calc(1rem + 6px)",
              paddingRight: compact ? "calc(0.75rem + 2px)" : "calc(1rem + 2px)",
            },
            ".cm-gutters": { backgroundColor: "rgb(var(--panel-2))", color: "rgb(var(--ink-3))", border: "none" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgb(var(--brand) / 0.06)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgb(var(--selection) / 0.2)" },
            "&.cm-focused": { boxShadow: "inset 0 0 0 2px rgb(var(--brand) / 0.45)", outline: "none" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compact, resizable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: livePreviewCompartmentRef.current.reconfigure(mode === "glossary" ? livePreviewExtension : []) });
    view.requestMeasure();
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

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    void upload(imageFiles(Array.from(event.target.files ?? [])));
    event.target.value = "";
  }

  function runToolbarAction(action: string) {
    switch (action) {
      case "bold": run((text, from, to) => wrapMarkdown(text, from, to, "**", "**", "굵은 텍스트")); break;
      case "italic": run((text, from, to) => wrapMarkdown(text, from, to, "*", "*", "기울임 텍스트")); break;
      case "strike": run((text, from, to) => wrapMarkdown(text, from, to, "~~", "~~", "취소선 텍스트")); break;
      case "inline-code": run((text, from, to) => wrapMarkdown(text, from, to, "`", "`", "코드")); break;
      case "link": run((text, from, to) => wrapMarkdown(text, from, to, "[", "](https://example.com)", "링크 텍스트")); break;
      case "inline-math": run((text, from, to) => wrapMarkdown(text, from, to, "$", "$", "E = mc^2")); break;
      case "quote": run(toggleQuoteMarkdown); break;
      case "bullet": run((text, from, to) => toggleListMarkdown(text, from, to, "bullet")); break;
      case "ordered": run((text, from, to) => toggleListMarkdown(text, from, to, "ordered")); break;
      case "task": run((text, from, to) => toggleListMarkdown(text, from, to, "task")); break;
      case "code-block": run(toggleCodeBlockMarkdown); break;
      case "table": run((text, from, to) => insertMarkdownBlock(text, from, to, "| 열 1 | 열 2 | 열 3 |\n| --- | --- | --- |\n| 내용 | 내용 | 내용 |")); break;
      case "block-math": run((text, from, to) => insertMarkdownBlock(text, from, to, "$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$")); break;
      case "mermaid": run((text, from, to) => insertMarkdownBlock(text, from, to, "```mermaid\nflowchart LR\n  A[시작] --> B[완료]\n```")); break;
      case "rule": run((text, from, to) => insertMarkdownBlock(text, from, to, "---")); break;
      case "image": setMode("text"); fileRef.current?.click(); break;
    }
  }

  return (
    <div
      ref={fullscreenRootRef}
      data-markdown-fullscreen={fullscreen}
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
      <div role="toolbar" aria-label="Markdown 서식 도구" className="markdown-editor-toolbar flex min-w-0 items-center gap-1 border-b border-line bg-panel-2 px-2 py-1.5">
        <div className="markdown-toolbar-heading flex shrink-0 items-center rounded-lg border border-line bg-panel p-0.5" aria-label="제목 수준">
          {[1, 2, 3, 4, 5, 6].map((level) => (
            <button
              key={level}
              type="button"
              aria-label={`제목 ${level}`}
              title={`제목 ${level} 적용/해제 (Ctrl+Alt+${level})`}
              disabled={disabled}
              onClick={() => run((text, from, to) => toggleHeadingMarkdown(text, from, to, level))}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
            >
              H{level}
            </button>
          ))}
        </div>

        <div className="markdown-toolbar-format-buttons flex shrink-0 items-center rounded-lg border border-line bg-panel p-0.5" aria-label="서식">
          <ToolbarButton label="굵게" title="굵게 (Ctrl+B)" disabled={disabled} onClick={() => runToolbarAction("bold")}><strong>B</strong></ToolbarButton>
          <ToolbarButton label="기울임" title="기울임 (Ctrl+I)" disabled={disabled} onClick={() => runToolbarAction("italic")}><em>I</em></ToolbarButton>
          <ToolbarButton label="취소선" title="취소선" disabled={disabled} onClick={() => runToolbarAction("strike")}><span className="line-through">S</span></ToolbarButton>
          <ToolbarButton label="인라인 코드" title="인라인 코드" disabled={disabled} onClick={() => runToolbarAction("inline-code")}><span className="font-mono">&lt;/&gt;</span></ToolbarButton>
          <ToolbarButton label="링크" title="링크 (Ctrl+K)" disabled={disabled} onClick={() => runToolbarAction("link")}>링크</ToolbarButton>
          <ToolbarButton label="인라인 수식" title="인라인 수식" disabled={disabled} onClick={() => runToolbarAction("inline-math")}>$x$</ToolbarButton>
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
          <ToolbarButton label="인용" title="인용문 적용/해제" disabled={disabled} onClick={() => runToolbarAction("quote")}>인용</ToolbarButton>
          <ToolbarButton label="글머리 목록" title="글머리 목록 적용/해제" disabled={disabled} onClick={() => runToolbarAction("bullet")}>•</ToolbarButton>
          <ToolbarButton label="번호 목록" title="번호 목록 적용/해제" disabled={disabled} onClick={() => runToolbarAction("ordered")}>1.</ToolbarButton>
          <ToolbarButton label="체크리스트" title="체크리스트 적용/해제" disabled={disabled} onClick={() => runToolbarAction("task")}>☑</ToolbarButton>
          <ToolbarButton label="코드 블록" title="코드 블록 적용/해제" disabled={disabled} onClick={() => runToolbarAction("code-block")}>코드</ToolbarButton>
        </div>

        <select
          aria-label="서식"
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            runToolbarAction(event.currentTarget.value);
            event.currentTarget.value = "";
          }}
          className="markdown-toolbar-format-select field !h-8 !w-[5rem] shrink-0 !px-2 !py-0 !pr-6 text-xs"
        >
          <option value="">서식</option>
          {FORMAT_MENU_ITEMS.map((item) => <option key={item.action} value={item.action}>{item.label}</option>)}
        </select>

        <select
          aria-label="삽입 도구"
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            runToolbarAction(event.currentTarget.value);
            event.currentTarget.value = "";
          }}
          className="markdown-toolbar-insert field !h-8 !w-[5.5rem] shrink-0 !px-2 !py-0 !pr-6 text-xs"
        >
          <option value="">삽입</option>
          {INSERT_MENU_ITEMS.map((item) => <option key={item.action} value={item.action} disabled={disabled || (item.action === "image" && uploadCount > 0)}>{item.label}</option>)}
        </select>

        <div className="markdown-toolbar-view-segments ml-auto flex shrink-0 items-center rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="본문 보기 방식">
          {([
            { value: "glossary", label: "서식 편집" },
            { value: "text", label: "텍스트" },
            { value: "preview", label: "미리보기" },
          ] as const).map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              onClick={() => setMode(item.value)}
              className={cx("rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand/40", mode === item.value ? "bg-brand-soft text-brand" : "text-ink-3 hover:bg-panel-2 hover:text-ink")}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          ref={viewSelectRef}
          aria-label="본문 보기 방식"
          value={mode}
          onChange={(event) => {
            if (event.currentTarget.value === "fullscreen") setFullscreen((current) => !current);
            else setMode(event.currentTarget.value as MarkdownView);
          }}
          className="markdown-toolbar-view-select field ml-auto !h-8 !w-[6.75rem] shrink-0 !px-2 !py-0 !pr-6 text-xs"
        >
          <option value="glossary">서식 편집</option>
          <option value="text">텍스트 편집</option>
          <option value="preview">미리보기</option>
          <option value="fullscreen">{fullscreen ? "전체 화면 닫기" : "전체 화면"}</option>
        </select>
        <button
          ref={fullscreenButtonRef}
          type="button"
          className="markdown-toolbar-fullscreen btn-ghost btn-sm h-8 w-8 shrink-0 !px-0"
          aria-label={fullscreen ? "전체 화면 닫기" : "전체 화면"}
          aria-pressed={fullscreen}
          title={fullscreen ? "전체 화면 닫기 (Esc)" : "전체 화면으로 편집"}
          onClick={() => setFullscreen((current) => !current)}
        >
          <span aria-hidden="true">{fullscreen ? "✕" : "⛶"}</span>
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={chooseFiles} />
      {uploadError && <div className="border-b border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger" aria-live="polite">{uploadError}</div>}
      <div className={`grid ${fullscreen || resizable ? "min-h-0 flex-1" : ""}`}>
        <div className={`${mode === "preview" ? "hidden" : "block"} h-full min-h-0 overflow-hidden`} aria-label={mode === "glossary" ? "서식 편집 Markdown 편집기" : "텍스트 Markdown 편집기"} ref={hostRef} />
        <div className={`${mode === "preview" ? "block" : "hidden"} ${resizable ? "min-h-0" : compact ? "min-h-40" : "min-h-[16rem]"} h-full overflow-auto ${compact ? "p-3" : "p-4"} ${fullscreen ? "min-h-0" : ""}`}>
          {value.trim() ? <MarkdownContent>{value}</MarkdownContent> : <p className="text-sm text-ink-3">미리보기가 여기에 표시됩니다.</p>}
        </div>
      </div>
      {maxLength !== undefined && (
        <div
          className={cx("shrink-0 border-t border-line px-3 py-1.5 text-right text-[11px] tabular-nums", value.length >= maxLength ? "text-danger" : "text-ink-3")}
          role="status"
          aria-live="polite"
        >
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}{value.length >= maxLength ? " · 최대 글자 수" : ""}
        </div>
      )}

    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ label, title, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 touch-manipulation items-center justify-center rounded-md text-[11px] text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
