"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_EMBED_COLUMN_KEYS,
  DEFAULT_EMBED_OPTIONS,
  buildEmbedPath,
  buildIframeCode,
  type EmbedTableOptions,
} from "@/lib/embed/sheet-share";
import { GRID_COLUMNS, type ColumnKey } from "@/lib/terms/grid";
import { cx } from "@/lib/ui/format";

type CopyKind = "url" | "iframe";

export function SheetShare({ baseQuery }: { baseQuery: string }) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<ColumnKey[]>([...DEFAULT_EMBED_COLUMN_KEYS]);
  const [options, setOptions] = useState<EmbedTableOptions>(DEFAULT_EMBED_OPTIONS);
  const [origin, setOrigin] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const embedPath = useMemo(() => buildEmbedPath(baseQuery, columns, options), [baseQuery, columns, options]);
  const url = origin ? `${origin}${embedPath}` : embedPath;
  const iframe = buildIframeCode(url, options.border);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggleColumn(key: ColumnKey) {
    setColumns((current) => {
      if (current.includes(key)) {
        if (current.length === 1) {
          setAnnouncement("표에는 열이 하나 이상 필요합니다.");
          return current;
        }
        return current.filter((column) => column !== key);
      }
      const selected = new Set([...current, key]);
      return GRID_COLUMNS.filter((column) => selected.has(column.key)).map((column) => column.key);
    });
  }

  async function copy(kind: CopyKind) {
    const value = kind === "url" ? url : iframe;
    try {
      await navigator.clipboard.writeText(value);
      setAnnouncement(kind === "url" ? "공유 URL을 복사했습니다." : "iframe 코드를 복사했습니다.");
    } catch {
      setAnnouncement("자동 복사에 실패했습니다. 아래 내용을 선택해 직접 복사해 주세요.");
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>
        <IconShare /> 공유하기
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto overscroll-contain bg-ink/35 p-3 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-share-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
          >
            <header className="flex items-start gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 id="sheet-share-title" className="text-base font-semibold">시트 공유</h2>
                <p className="mt-1 text-xs leading-5 text-ink-3">현재 필터와 정렬을 유지한 읽기 전용 표를 공유합니다.</p>
              </div>
              <button ref={closeRef} type="button" className="btn-quiet ml-auto h-8 w-8 p-0 text-lg" onClick={close} aria-label="공유 창 닫기">×</button>
            </header>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              <fieldset>
                <legend className="text-sm font-medium">표시할 열 <span className="font-normal text-ink-3">{columns.length}/{GRID_COLUMNS.length}</span></legend>
                <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {GRID_COLUMNS.map((column) => (
                    <label key={column.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-ink-2 hover:bg-panel-2">
                      <input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggleColumn(column.key)} className="h-4 w-4 accent-brand" />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-4 border-t border-line pt-4">
                <legend className="text-sm font-medium">임베드 옵션</legend>
                <div className="mt-2 grid gap-1 sm:grid-cols-3">
                  <OptionCheck label="촘촘하게" checked={options.compact} onChange={(compact) => setOptions({ ...options, compact })} />
                  <OptionCheck label="상세 링크 사용" checked={options.links} onChange={(links) => setOptions({ ...options, links })} />
                  <OptionCheck label="바깥 테두리" checked={options.border} onChange={(border) => setOptions({ ...options, border })} />
                </div>
              </fieldset>

              <ShareOutput title="공유 URL" description="새 탭에서 열거나 Confluence URL 매크로에 붙여 넣습니다." value={url} onCopy={() => void copy("url")} copyLabel="URL 복사" />
              <ShareOutput title="iframe 코드" description="HTML/iframe 삽입을 지원하는 페이지에 그대로 붙여 넣습니다." value={iframe} onCopy={() => void copy("iframe")} copyLabel="iframe 복사" />
              <p aria-live="polite" className={cx("mt-3 min-h-5 text-xs", announcement.includes("실패") ? "text-danger" : "text-ok")}>{announcement}</p>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function OptionCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-xs text-ink-2 hover:bg-panel-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand" />{label}</label>;
}

function ShareOutput({ title, description, value, onCopy, copyLabel }: { title: string; description: string; value: string; onCopy: () => void; copyLabel: string }) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-panel-2/55 p-3">
      <div className="flex items-end gap-3"><div><h3 className="text-xs font-semibold">{title}</h3><p className="mt-0.5 text-[11px] leading-4 text-ink-3">{description}</p></div><button type="button" className="btn-ghost btn-sm ml-auto shrink-0" onClick={onCopy}>{copyLabel}</button></div>
      <textarea readOnly value={value} rows={title === "공유 URL" ? 2 : 3} onFocus={(event) => event.currentTarget.select()} className="field mt-2 resize-none font-mono text-[11px] leading-5" aria-label={`${title} 내용`} />
    </section>
  );
}

function IconShare() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" /><path d="m5.8 7.1 4.4-2.2M5.8 8.9l4.4 2.2" /></svg>;
}
