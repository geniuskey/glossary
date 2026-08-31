"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { basicSetup, EditorView } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { MarkdownContent } from "./markdown-content";

interface UploadResponse {
  url: string;
  originalFilename: string;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  onUploadingChange?: (uploading: boolean) => void;
}

function imageFiles(items: Iterable<File>): File[] {
  return [...items].filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
}

function imageAlt(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return (base || "첨부 이미지").replaceAll("]", "\\]");
}

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  maxLength,
  onUploadingChange,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState<"edit" | "preview">("edit");
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
          EditorState.readOnly.of(disabled),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
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
            "&": { minHeight: "26rem", backgroundColor: "transparent", color: "rgb(var(--ink))" },
            ".cm-content": { minHeight: "26rem", padding: "1rem", caretColor: "rgb(var(--brand))" },
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
  }, [disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  function wrapSelection(before: string, after = before) {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || "텍스트";
    insertText(`${before}${selected}${after}`, from, to);
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    void upload(imageFiles(Array.from(event.target.files ?? [])));
    event.target.value = "";
  }

  return (
    <div
      data-markdown-fullscreen={fullscreen}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? "본문 Markdown 전체 화면 편집기" : undefined}
      className={fullscreen
        ? "fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-panel"
        : "overflow-hidden rounded-xl border border-line bg-panel"}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel-2 px-2 py-2">
        <button type="button" className="btn-quiet btn-sm" disabled={disabled} onClick={() => wrapSelection("**")}>굵게</button>
        <button type="button" className="btn-quiet btn-sm" disabled={disabled} onClick={() => wrapSelection("`")}>코드</button>
        <button type="button" className="btn-quiet btn-sm" disabled={disabled} onClick={() => insertText("\n## 제목\n")}>제목</button>
        <button type="button" className="btn-quiet btn-sm" disabled={disabled} onClick={() => wrapSelection("[", "](https://)")}>링크</button>
        <button type="button" className="btn-ghost btn-sm" disabled={disabled || uploadCount > 0} onClick={() => fileRef.current?.click()}>
          {uploadCount > 0 ? `이미지 변환 중 ${uploadCount}` : "이미지 첨부"}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={chooseFiles} />
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 hidden text-[11px] text-ink-3 md:inline">붙여넣기·드롭 가능 · WebP 자동 변환</span>
          <div className="flex lg:hidden">
            <button type="button" className={`btn-sm ${mobileMode === "edit" ? "btn-primary" : "btn-quiet"}`} onClick={() => setMobileMode("edit")}>편집</button>
            <button type="button" className={`btn-sm ${mobileMode === "preview" ? "btn-primary" : "btn-quiet"}`} onClick={() => setMobileMode("preview")}>미리보기</button>
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
      {uploadError && <div className="border-b border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger">{uploadError}</div>}
      <div className={`grid lg:grid-cols-2 lg:divide-x lg:divide-line ${fullscreen ? "min-h-0 flex-1" : ""}`}>
        <div className={`${mobileMode === "preview" ? "hidden lg:block" : "block"} min-h-0 overflow-auto`} ref={hostRef} />
        <div className={`${mobileMode === "edit" ? "hidden lg:block" : "block"} min-h-[26rem] overflow-auto p-4 ${fullscreen ? "lg:min-h-0" : ""}`}>
          {value.trim() ? <MarkdownContent>{value}</MarkdownContent> : <p className="text-sm text-ink-3">미리보기가 여기에 표시됩니다.</p>}
        </div>
      </div>
      {maxLength !== undefined && <div className="shrink-0 border-t border-line px-3 py-1.5 text-right text-[11px] text-ink-3">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</div>}
    </div>
  );
}
