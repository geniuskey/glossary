"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { basicSetup, EditorView } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
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
  originalFilename: string;
}

interface MarkdownEditorProps {
  label?: string;
  describedBy?: string;
  invalid?: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  compact?: boolean;
  resizable?: boolean;
  embedded?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

function imageFiles(items: Iterable<File>): File[] {
  return [...items].filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
}

function imageAlt(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return (base || "첨부 이미지").replaceAll("]", "\\]");
}

type MarkdownCommand = (source: string, from: number, to: number) => MarkdownEdit;

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
  label = "Markdown 본문",
  describedBy,
  invalid = false,
  value,
  onChange,
  disabled = false,
  maxLength,
  compact = false,
  resizable = false,
  embedded = false,
  onUploadingChange,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [fullscreen, setFullscreen] = useState(false);

  onChangeRef.current = onChange;

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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
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
    const view = viewRef.current;
    if (!view || disabled) return;
    setMode("edit");
    applyCommand(view, command);
  }

  async function upload(files: File[]) {
    if (disabled || files.length === 0) return;
    setUploadError(null);
    setUploadCount((count) => count + files.length);

    const snippets: string[] = [];
    for (const file of files) {
      try {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/v1/attachments", { method: "POST", body });
        const result = await response.json().catch(() => null) as (UploadResponse & { error?: { message?: string } }) | null;
        if (!response.ok || !result?.url) throw new Error(result?.error?.message || "이미지를 업로드하지 못했습니다.");
        snippets.push(`![${imageAlt(file)}](${result.url})`);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "이미지를 업로드하지 못했습니다.");
      } finally {
        setUploadCount((count) => count - 1);
      }
    }
    if (snippets.length > 0) insertText(`\n${snippets.join("\n")}\n`);
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
          EditorView.contentAttributes.of({
            "aria-label": label,
            ...(describedBy ? { "aria-describedby": describedBy } : {}),
            ...(invalid ? { "aria-invalid": "true" } : {}),
          }),
          EditorState.readOnly.of(disabled),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown(event, view) {
              if (disabled) return false;
              return handleMarkdownShortcut(event, view);
            },
            paste(event) {
              const files = imageFiles(Array.from(event.clipboardData?.files ?? []));
              if (files.length === 0) return false;
              event.preventDefault();
              void upload(files);
              return true;
            },
            drop(event, view) {
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
            "&": { height: resizable ? "100%" : "auto", minHeight: compact ? "10rem" : "16rem", backgroundColor: "transparent", color: "rgb(var(--ink))" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              minHeight: resizable ? "100%" : compact ? "10rem" : "16rem",
              padding: compact ? "0.75rem" : "1rem",
              caretColor: "rgb(var(--brand))",
              fontFamily: '"Noto Sans KR Variable", "Noto Sans KR", Pretendard, sans-serif',
              fontSize: "14px",
              lineHeight: "1.75",
              letterSpacing: "-0.012em",
            },
            ".cm-gutters": { backgroundColor: "rgb(var(--panel-2))", color: "rgb(var(--ink-3))", border: "none" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgb(var(--brand) / 0.06)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgb(var(--selection) / 0.2)" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // disabled 변경 시 인스턴스를 다시 만들어 readOnly 상태까지 정확히 반영한다.
  }, [compact, describedBy, disabled, invalid, label, resizable]);

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

  return (
    <div
      data-markdown-fullscreen={fullscreen}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? `${label} 전체 화면 편집기` : undefined}
      className={fullscreen
        ? "fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-panel"
        : cx(
          "overflow-hidden bg-panel",
          !embedded && "rounded-xl border border-line",
          "korean-editor-font",
          resizable && "flex h-80 min-h-64 max-h-[75dvh] flex-col resize-y",
        )}
    >
      <div className="shrink-0 border-b border-line bg-panel-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-2 py-1.5">
          <p className="text-xs font-medium text-ink-2">Markdown</p>
          <span className="hidden text-[11px] text-ink-3 md:inline">선택한 텍스트에 서식을 적용합니다</span>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex" aria-label="본문 보기 방식">
              <button type="button" aria-pressed={mode === "edit"} className={`btn-sm ${mode === "edit" ? "btn-primary" : "btn-quiet"}`} onClick={() => setMode("edit")}>편집</button>
              <button type="button" aria-pressed={mode === "preview"} className={`btn-sm ${mode === "preview" ? "btn-primary" : "btn-quiet"}`} onClick={() => setMode("preview")}>미리보기</button>
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-pressed={fullscreen}
              title={fullscreen ? "전체 화면 닫기 (Esc)" : "전체 화면으로 편집"}
              onClick={() => setFullscreen((current) => !current)}
            >
              {fullscreen ? "전체 화면 닫기" : "전체 화면"}
            </button>
          </div>
        </div>

        <div role="toolbar" aria-label="Markdown 서식 도구" className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
          <div className="flex shrink-0 items-center gap-0.5" aria-label="제목">
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <ToolbarButton
                key={level}
                label={`제목 ${level}`}
                title={`제목 ${level} 적용/해제 (Ctrl+Alt+${level})`}
                disabled={disabled}
                onClick={() => run((text, from, to) => toggleHeadingMarkdown(text, from, to, level))}
              >
                H{level}
              </ToolbarButton>
            ))}
          </div>

          <ToolbarDivider />
          <div className="flex shrink-0 items-center gap-0.5" aria-label="인라인 서식">
            <ToolbarButton label="굵게" title="굵게 (Ctrl+B)" disabled={disabled} onClick={() => run((text, from, to) => wrapMarkdown(text, from, to, "**", "**", "굵은 텍스트"))}><strong>B</strong></ToolbarButton>
            <ToolbarButton label="기울임" title="기울임 (Ctrl+I)" disabled={disabled} onClick={() => run((text, from, to) => wrapMarkdown(text, from, to, "*", "*", "기울임 텍스트"))}><em>I</em></ToolbarButton>
            <ToolbarButton label="취소선" title="취소선" disabled={disabled} onClick={() => run((text, from, to) => wrapMarkdown(text, from, to, "~~", "~~", "취소선 텍스트"))}><span className="line-through">S</span></ToolbarButton>
            <ToolbarButton label="인라인 코드" title="인라인 코드" disabled={disabled} onClick={() => run((text, from, to) => wrapMarkdown(text, from, to, "`", "`", "코드"))}><span className="font-mono">&lt;/&gt;</span></ToolbarButton>
            <ToolbarButton label="링크" title="링크 (Ctrl+K)" disabled={disabled} onClick={() => run((text, from, to) => wrapMarkdown(text, from, to, "[", "](https://example.com)", "링크 텍스트"))}>링크</ToolbarButton>
          </div>

          <ToolbarDivider />
          <div className="flex shrink-0 items-center gap-0.5" aria-label="블록 서식">
            <ToolbarButton label="인용문" title="인용문 적용/해제" disabled={disabled} onClick={() => run(toggleQuoteMarkdown)}>인용</ToolbarButton>
            <ToolbarButton label="글머리 목록" title="글머리 목록 적용/해제" disabled={disabled} onClick={() => run((text, from, to) => toggleListMarkdown(text, from, to, "bullet"))}>• 목록</ToolbarButton>
            <ToolbarButton label="번호 목록" title="번호 목록 적용/해제" disabled={disabled} onClick={() => run((text, from, to) => toggleListMarkdown(text, from, to, "ordered"))}>1. 목록</ToolbarButton>
            <ToolbarButton label="체크리스트" title="체크리스트 적용/해제" disabled={disabled} onClick={() => run((text, from, to) => toggleListMarkdown(text, from, to, "task"))}>☑ 목록</ToolbarButton>
            <ToolbarButton label="코드 블록" title="코드 블록 적용/해제" disabled={disabled} onClick={() => run(toggleCodeBlockMarkdown)}>코드 블록</ToolbarButton>
          </div>

          <ToolbarDivider />
          <div className="flex shrink-0 items-center gap-0.5" aria-label="삽입">
            <ToolbarButton
              label="표 삽입"
              title="3열 표 삽입"
              disabled={disabled}
              onClick={() => run((text, from, to) => insertMarkdownBlock(text, from, to, "| 열 1 | 열 2 | 열 3 |\n| --- | --- | --- |\n| 내용 | 내용 | 내용 |"))}
            >표</ToolbarButton>
            <ToolbarButton label="구분선 삽입" title="구분선 삽입" disabled={disabled} onClick={() => run((text, from, to) => insertMarkdownBlock(text, from, to, "---"))}>구분선</ToolbarButton>
            <ToolbarButton
              label="이미지 첨부"
              title="이미지 첨부 · 붙여넣기와 드롭도 가능"
              disabled={disabled || uploadCount > 0}
              onClick={() => { setMode("edit"); fileRef.current?.click(); }}
            >
              {uploadCount > 0 ? `변환 중 ${uploadCount}` : "이미지"}
            </ToolbarButton>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={chooseFiles} />
      </div>
      {uploadError && <div className="border-b border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger" aria-live="polite">{uploadError}</div>}
      <div className={`grid ${fullscreen || resizable ? "min-h-0 flex-1" : ""}`}>
        <div className={`${mode === "preview" ? "hidden" : "block"} h-full min-h-0 overflow-auto`} ref={hostRef} />
        <div className={`${mode === "edit" ? "hidden" : "block"} ${resizable ? "min-h-0" : compact ? "min-h-40" : "min-h-[16rem]"} h-full overflow-auto ${compact ? "p-3" : "p-4"} ${fullscreen ? "min-h-0" : ""}`}>
          {value.trim() ? <MarkdownContent>{value}</MarkdownContent> : <p className="text-sm text-ink-3">미리보기가 여기에 표시됩니다.</p>}
        </div>
      </div>
      {maxLength !== undefined && <div className="shrink-0 border-t border-line px-3 py-1.5 text-right text-[11px] text-ink-3">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</div>}
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
      className="inline-flex h-8 min-w-8 shrink-0 touch-manipulation items-center justify-center rounded-md px-2 text-xs text-ink-2 transition-colors hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;
}
