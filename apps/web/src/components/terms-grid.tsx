"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { STATUS_TONE } from "@/components/term-badges";
import { TERM_STATUS_LABEL, TERM_TYPE_LABEL } from "@/lib/terms/enums";
import {
  applyPatch,
  cellText,
  defaultHiddenColumns,
  GRID_COLUMNS,
  patchForCell,
  toCsv,
  toTsv,
  wouldClearBothNames,
  type ColumnKey,
  type GridColumn,
  type SortDir,
  type SortKey,
  type TermRow,
} from "@/lib/terms/grid";
import { cx, isoDate, relativeTime } from "@/lib/ui/format";

const HIDDEN_STORAGE_KEY = "grossary.grid.hidden";

type Note = { tone: "error" | "conflict"; text: string };

const DRAFT_NOTE_ID = "__draft__";

export interface TermsGridProps {
  rows: TermRow[];
  /** 저장 직후 "최근 수정" 칸에 보여줄 이름. 서버를 다시 읽지 않기 위한 값이다. */
  viewerName: string;
  canDelete: boolean;
  /**
   * 현재 페이지 첫 행의 번호 - 1. 행 번호가 페이지마다 1부터 다시 시작하면
   * "표 몇 번째 줄"로 서로 이야기할 수 없다(함께 쓰는 표라 이게 실제로 중요하다).
   */
  rowOffset: number;
  /**
   * 정렬 링크는 서버에서 만들어 넘긴다 — buildSortHref가 있는 list-params.ts는
   * @grossary/db를 import하므로 클라이언트 번들로 끌고 올 수 없다(R114).
   */
  sortHrefs: Partial<Record<SortKey, string>>;
  sortState: { key: SortKey; dir: SortDir };
}

export function TermsGrid(props: TermsGridProps) {
  const router = useRouter();
  const [rows, setRows] = useState(props.rows);
  const [hidden, setHidden] = useState<ColumnKey[]>(defaultHiddenColumns);
  const [columnMenu, setColumnMenu] = useState(false);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState<Date | null>(null);
  const [draft, setDraft] = useState({ nameEn: "", nameKo: "" });
  const [creating, setCreating] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // 서버에서 새 목록이 오면(검색/정렬/페이지 이동, router.refresh) 그대로 갈아탄다.
  // 편집 중이던 좌표는 다른 행을 가리키게 되므로 함께 버린다.
  useEffect(() => {
    setRows(props.rows);
    setEditing(null);
    setSelected(new Set());
  }, [props.rows]);

  // 상대 시간은 렌더 시각에 따라 값이 달라져서 SSR 결과와 hydration 결과가
  // 어긋난다("방금" vs "1분 전"). 첫 렌더는 양쪽 다 ISO 날짜로 그리고, 마운트
  // 후에만 상대 시간으로 바꾼다.
  useEffect(() => setNow(new Date()), []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_STORAGE_KEY);
      if (saved) setHidden(JSON.parse(saved) as ColumnKey[]);
    } catch {
      // 저장소를 못 읽어도 기본 열 구성으로 동작한다.
    }
  }, []);

  const columns = useMemo(() => GRID_COLUMNS.filter((c) => !hidden.includes(c.key)), [hidden]);

  function toggleColumn(key: ColumnKey) {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 열 구성을 저장 못 해도 이번 세션에서는 그대로 적용된다.
    }
  }

  function note(id: string, value: Note | null) {
    setNotes((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }

  function markBusy(id: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * 셀 하나를 저장한다. 화면에는 먼저 반영하고(낙관적) 실패하면 되돌린다 —
   * 한 칸 고칠 때마다 왕복을 기다리면 연속 입력이 불가능하다.
   *
   * expectedRevision을 항상 함께 보낸다. 여럿이 같이 쓰는 사전이라 같은 행을
   * 동시에 고치는 일이 실제로 일어나고, 그때 조용히 덮어쓰는 대신 409를 받아
   * 그 줄에만 표시한다.
   */
  async function saveCell(row: TermRow, key: ColumnKey, raw: string) {
    const parsed = patchForCell(key, raw);
    if ("error" in parsed) {
      note(row.id, { tone: "error", text: parsed.error });
      return;
    }
    if (cellText(row, key) === raw.trim()) {
      note(row.id, null);
      return;
    }
    if (wouldClearBothNames(row, parsed.patch)) {
      note(row.id, { tone: "error", text: "영문·국문 표준명을 둘 다 비울 수는 없습니다." });
      return;
    }

    const before = row;
    setRows((prev) => prev.map((r) => (r.id === row.id ? applyPatch(r, parsed.patch) : r)));
    note(row.id, null);
    markBusy(row.id, true);

    try {
      const res = await fetch(`/api/v1/terms/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed.patch, expectedRevision: row.revision }),
      });

      if (res.ok) {
        // 성공했다는 건 방금 보낸 expectedRevision이 서버의 현재 값이었다는
        // 뜻이므로, 새 리비전 번호는 그 다음 값이다(응답에는 리비전이 없다).
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  revision: row.revision + 1,
                  updatedAt: new Date().toISOString(),
                  editorName: props.viewerName,
                }
              : r,
          ),
        );
        return;
      }

      setRows((prev) => prev.map((r) => (r.id === row.id ? before : r)));
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.status === 409) {
        note(row.id, { tone: "conflict", text: "다른 사람이 먼저 수정했습니다. 새로고침 후 다시 시도하세요." });
      } else {
        note(row.id, { tone: "error", text: body?.error?.message ?? `저장하지 못했습니다 (${res.status}).` });
      }
    } catch {
      setRows((prev) => prev.map((r) => (r.id === row.id ? before : r)));
      note(row.id, { tone: "error", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      markBusy(row.id, false);
    }
  }

  async function createFromDraft() {
    const nameEn = draft.nameEn.trim();
    const nameKo = draft.nameKo.trim();
    if (!nameEn && !nameKo) return;

    setCreating(true);
    try {
      const res = await fetch("/api/v1/terms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nameEn: nameEn || undefined, nameKo: nameKo || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        note(DRAFT_NOTE_ID, { tone: "error", text: body?.error?.message ?? `추가하지 못했습니다 (${res.status}).` });
        return;
      }
      setDraft({ nameEn: "", nameKo: "" });
      note(DRAFT_NOTE_ID, null);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function applyBulkStatus(status: string) {
    for (const row of rows.filter((r) => selected.has(r.id))) {
      await saveCell(row, "status", status);
    }
    router.refresh();
  }

  async function deleteSelected() {
    for (const row of rows.filter((r) => selected.has(r.id))) {
      markBusy(row.id, true);
      const res = await fetch(`/api/v1/terms/${row.id}`, { method: "DELETE" });
      markBusy(row.id, false);
      if (!res.ok) note(row.id, { tone: "error", text: `삭제하지 못했습니다 (${res.status}).` });
    }
    setSelected(new Set());
    router.refresh();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없다고 표 편집 자체를 막을 이유는 없다.
    }
  }

  function downloadCsv() {
    const target = selected.size ? rows.filter((r) => selected.has(r.id)) : rows;
    // 엑셀은 BOM이 없으면 UTF-8 CSV의 한글을 깨뜨린다.
    const blob = new Blob(["﻿", toCsv(target, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grossary-${isoDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function move(dr: number, dc: number) {
    setActive((prev) => {
      const base = prev ?? { r: 0, c: 0 };
      return {
        r: Math.min(rows.length - 1, Math.max(0, base.r + dr)),
        c: Math.min(columns.length - 1, Math.max(0, base.c + dc)),
      };
    });
  }

  function beginEdit(r: number, c: number, seed?: string) {
    const column = columns[c];
    const row = rows[r];
    if (!column || !row || column.kind === "readonly") return;
    setEditing({ r, c, value: seed ?? cellText(row, column.key) });
  }

  function onCellKeyDown(event: React.KeyboardEvent, r: number, c: number) {
    if (editing) return;
    const column = columns[c];
    const row = rows[r];
    if (!column || !row) return;

    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      move(
        key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0,
        key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0,
      );
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      move(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      beginEdit(r, c);
      return;
    }
    if ((key === "Delete" || key === "Backspace") && column.kind === "text") {
      event.preventDefault();
      void saveCell(row, column.key, "");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "c") {
      event.preventDefault();
      const picked = rows.filter((x) => selected.has(x.id));
      void copy(picked.length ? toTsv(picked, columns) : cellText(row, column.key));
      return;
    }
    // 엑셀처럼, 그냥 타이핑하면 그 글자로 편집이 시작된다.
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      beginEdit(r, c, column.kind === "enum" ? undefined : key);
    }
  }

  function commitEdit(nextMove: "down" | "right" | null) {
    if (!editing) return;
    const column = columns[editing.c];
    const row = rows[editing.r];
    const value = editing.value;
    setEditing(null);
    if (column && row) void saveCell(row, column.key, value);
    if (nextMove === "down") move(1, 0);
    if (nextMove === "right") move(0, 1);
  }

  // 활성 셀로 포커스를 옮긴다. 셀마다 ref를 두는 대신 좌표를 data 속성으로 두고
  // 찾는다 — 행 목록이 갈릴 때마다 ref 맵을 정리할 필요가 없다.
  useEffect(() => {
    if (!active || editing) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-cell="${active.r}:${active.c}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, editing]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2 text-xs">
        <span className="hidden text-ink-3 sm:inline">
          <span className="kbd">↑↓←→</span> 이동 · <span className="kbd">Enter</span> 편집 ·{" "}
          <span className="kbd">Esc</span> 취소 · <span className="kbd">Del</span> 비우기
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setColumnMenu((v) => !v)}>
              열 {columns.length}/{GRID_COLUMNS.length}
            </button>
            {columnMenu && (
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-panel p-1 shadow-pop">
                {GRID_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-panel-2"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="accent-brand"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={downloadCsv} title="현재 목록을 CSV로 저장">
            CSV
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col style={{ width: 56 }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: 48 }} />
          </colgroup>

          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b border-r border-grid bg-panel-2 px-2 py-1.5">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="accent-brand"
                />
              </th>
              {columns.map((col) => (
                <HeaderCell key={col.key} column={col} sortHrefs={props.sortHrefs} sortState={props.sortState} />
              ))}
              <th className="sticky top-0 z-10 border-b border-grid bg-panel-2 px-2 py-1.5" />
            </tr>
          </thead>

          <tbody ref={bodyRef}>
            {rows.map((row, r) => {
              const rowNote = notes[row.id];
              return (
                <Fragment key={row.id}>
                  <tr className={cx("group", selected.has(row.id) && "bg-brand-soft/40")}>
                    <td className="sticky left-0 z-10 border-b border-r border-grid bg-panel px-2 align-middle group-hover:bg-panel-2">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          aria-label={`${row.slug} 선택`}
                          checked={selected.has(row.id)}
                          onChange={() => {
                            const next = new Set(selected);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            setSelected(next);
                          }}
                          className="accent-brand"
                        />
                        <span className="font-mono text-[10px] text-ink-3">{props.rowOffset + r + 1}</span>
                      </span>
                    </td>

                    {columns.map((col, c) => {
                      const isActive = active?.r === r && active?.c === c;
                      const isEditing = editing?.r === r && editing?.c === c;
                      return (
                        <td
                          key={col.key}
                          data-cell={`${r}:${c}`}
                          tabIndex={-1}
                          onMouseDown={() => setActive({ r, c })}
                          onDoubleClick={() => beginEdit(r, c)}
                          onKeyDown={(e) => onCellKeyDown(e, r, c)}
                          className={cx(
                            "relative h-8 border-b border-r border-grid px-2 align-middle outline-none",
                            col.kind === "readonly" ? "bg-panel-2/40 text-ink-3" : "bg-panel",
                            "group-hover:bg-panel-2/60",
                            isActive && "z-10 shadow-cell",
                          )}
                        >
                          {isEditing ? (
                            <CellEditor
                              column={col}
                              value={editing.value}
                              onChange={(v) => setEditing({ r, c, value: v })}
                              onCommit={commitEdit}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <CellView row={row} column={col} now={now} />
                          )}
                        </td>
                      );
                    })}

                    <td className="border-b border-grid bg-panel text-center group-hover:bg-panel-2/60">
                      {busy.has(row.id) ? (
                        <span className="text-[10px] text-ink-3">저장…</span>
                      ) : (
                        <Link href={`/terms/${row.slug}`} className="text-ink-3 hover:text-brand" title="용어 페이지">
                          ↗
                        </Link>
                      )}
                    </td>
                  </tr>

                  {rowNote && (
                    <tr>
                      <td colSpan={columns.length + 2} className="border-b border-grid bg-panel px-3 py-1.5">
                        <span
                          className={cx(
                            "inline-flex items-center gap-2 text-xs",
                            rowNote.tone === "conflict" ? "text-warn" : "text-danger",
                          )}
                        >
                          {rowNote.text}
                          {rowNote.tone === "conflict" && (
                            <button type="button" className="btn-ghost btn-sm" onClick={() => router.refresh()}>
                              새로고침
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* 엑셀의 마지막 빈 줄. 여기에 이름을 적고 Enter를 누르면 그대로 새
                용어가 만들어진다 — "새로 만들기" 화면을 거치지 않아도 표 안에서
                목록이 자란다. */}
            <tr>
              <td className="sticky left-0 z-10 border-b border-r border-grid bg-panel px-2 text-center text-ink-3">
                +
              </td>
              <td colSpan={columns.length + 1} className="border-b border-grid bg-panel px-2 py-1">
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    value={draft.nameEn}
                    onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && void createFromDraft()}
                    placeholder="새 용어 영문명"
                    className="h-7 w-48 rounded border border-line bg-panel px-2 text-sm placeholder:text-ink-3 focus:border-brand focus:outline-none"
                  />
                  <input
                    value={draft.nameKo}
                    onChange={(e) => setDraft({ ...draft, nameKo: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && void createFromDraft()}
                    placeholder="국문명"
                    className="h-7 w-40 rounded border border-line bg-panel px-2 text-sm placeholder:text-ink-3 focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => void createFromDraft()}
                    disabled={creating || (!draft.nameEn.trim() && !draft.nameKo.trim())}
                  >
                    추가
                  </button>
                  {notes[DRAFT_NOTE_ID] && <span className="text-xs text-danger">{notes[DRAFT_NOTE_ID].text}</span>}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-ink-3">
            조건에 맞는 용어가 없습니다. 표 마지막 줄에 이름을 적으면 바로 만들어집니다.
          </p>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-2 text-sm shadow-pop">
          <span className="font-medium">{selected.size}개 선택</span>
          <select
            className="field h-8 w-auto py-0 text-xs"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              e.target.value = "";
              if (value) void applyBulkStatus(value);
            }}
          >
            <option value="">상태 일괄 변경…</option>
            {Object.entries(TERM_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void copy(toTsv(rows.filter((r) => selected.has(r.id)), columns))}
          >
            표로 복사
          </button>
          {props.canDelete && (
            <button type="button" className="btn-danger btn-sm" onClick={() => void deleteSelected()}>
              삭제
            </button>
          )}
          <button type="button" className="btn-quiet btn-sm ml-auto" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}
    </div>
  );
}

function HeaderCell({
  column,
  sortHrefs,
  sortState,
}: {
  column: GridColumn;
  sortHrefs: Partial<Record<SortKey, string>>;
  sortState: { key: SortKey; dir: SortDir };
}) {
  const href = column.sortKey ? sortHrefs[column.sortKey] : undefined;
  const on = column.sortKey !== undefined && column.sortKey === sortState.key;
  const label = (
    <>
      {column.label}
      {on && <span className="ml-1">{sortState.dir === "asc" ? "▲" : "▼"}</span>}
    </>
  );

  return (
    <th
      scope="col"
      className={cx(
        "sticky top-0 z-10 border-b border-r border-grid bg-panel-2 px-2 py-1.5 text-left text-[11px] font-medium",
        on ? "text-brand" : "text-ink-2",
      )}
    >
      {href ? (
        <Link href={href} scroll={false} className="flex items-center hover:text-ink">
          {label}
        </Link>
      ) : (
        <span className="flex items-center">{label}</span>
      )}
    </th>
  );
}

function CellView({ row, column, now }: { row: TermRow; column: GridColumn; now: Date | null }) {
  if (column.key === "updatedAt") {
    const at = new Date(row.updatedAt);
    return (
      <span className="flex flex-col leading-tight">
        <span className="text-xs">{now ? relativeTime(at, now) : isoDate(at)}</span>
        {row.editorName && <span className="truncate text-[10px] text-ink-3">{row.editorName}</span>}
      </span>
    );
  }

  if (column.key === "status") {
    return (
      <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS_TONE[row.status])}>
        {TERM_STATUS_LABEL[row.status]}
      </span>
    );
  }

  if (column.key === "termType") {
    return <span className="text-xs text-ink-2">{TERM_TYPE_LABEL[row.termType]}</span>;
  }

  if (column.key === "domain") {
    if (row.domain.length === 0) return null;
    return (
      <span className="flex gap-1 overflow-hidden">
        {row.domain.map((d) => (
          <span key={d} className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-2">
            {d}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={cx("block truncate", column.mono && "font-mono text-xs")}>{cellText(row, column.key)}</span>
  );
}

function CellEditor({
  column,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  column: GridColumn;
  value: string;
  onChange: (v: string) => void;
  onCommit: (move: "down" | "right" | null) => void;
  onCancel: () => void;
}) {
  if (column.kind === "enum") {
    return (
      <select
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") onCommit("down");
        }}
        className="absolute inset-0 h-full w-full border-0 bg-panel px-2 text-sm text-ink outline-none ring-2 ring-brand"
      >
        {column.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit("down");
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onCommit("right");
        }
      }}
      className="absolute inset-0 h-full w-full border-0 bg-panel px-2 text-sm text-ink outline-none ring-2 ring-brand"
    />
  );
}
