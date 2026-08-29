"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STATUS_TONE } from "@/components/term-badges";
import {
  TERM_STATUSES,
  TERM_STATUS_LABEL,
  TERM_TYPE_LABEL,
  type TermStatusLiteral,
} from "@/lib/terms/enums";
import {
  applyPatch,
  cellText,
  clampColumnWidth,
  clampMenuPosition,
  defaultHiddenColumns,
  DENSITIES,
  DENSITY_LABEL,
  DENSITY_ROW_PX,
  GRID_COLUMNS,
  inRange,
  inversePatch,
  isDensity,
  normalizeRange,
  opensOnClick,
  opensUp,
  parseClipboardMatrix,
  planCell,
  planClear,
  planFill,
  planPaste,
  rangeCells,
  rangeToTsv,
  rowLabel,
  toCsv,
  toggleHiddenColumn,
  toTsv,
  visibleColumns,
  type Bounds,
  type CellRange,
  type CellRef,
  type ColumnKey,
  type Density,
  type GridColumn,
  type RowPatch,
  type SortDir,
  type SortKey,
  type TermRow,
  type WritePlan,
} from "@/lib/terms/grid";
import { cx, isoDate, relativeTime } from "@/lib/ui/format";

const HIDDEN_KEY = "grossary.grid.hidden";
const WIDTH_KEY = "grossary.grid.widths";
const DENSITY_KEY = "grossary.grid.density";

/** 행 번호 + 체크박스 + 열기 버튼이 들어가는 왼쪽 고정 칸의 너비(px). */
const GUTTER_W = 66;
/** 되돌리기 깊이. 표 편집은 한 번에 수십 칸이 바뀌므로 무한정 쌓으면 메모리가 는다. */
const UNDO_LIMIT = 40;
/** 한 번에 띄우는 PATCH 수. 붙여넣기 50줄을 한꺼번에 쏘면 커넥션 풀이 마른다. */
const CONCURRENCY = 6;

type Toast = { id: number; tone: "error" | "conflict" | "ok"; text: string; refresh?: boolean };
type Batch = { label: string; entries: RowPatch[] };
/** 되돌린 결과(역패치)를 어느 더미에 쌓을지. "edit"만 다시하기 더미를 비운다. */
type CommitMode = "edit" | "undo" | "redo";

const STATUS_VALUES: ReadonlySet<string> = new Set(TERM_STATUSES);

/** enum 후보 목록의 값은 string이라 STATUS_TONE(유니온 키)에 바로 못 넣는다. */
function statusTone(value: string): string | null {
  return STATUS_VALUES.has(value) ? STATUS_TONE[value as TermStatusLiteral] : null;
}

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
  /** 머리글 우클릭 메뉴는 방향을 눌러 고르므로 토글이 아닌 두 방향의 링크가 필요하다. */
  sortDirHrefs: Partial<Record<SortKey, { asc: string; desc: string }>>;
  sortState: { key: SortKey; dir: SortDir };
  /** 검색어. 셀 안에서 어디가 걸렸는지 표시하는 데만 쓴다. */
  query?: string;
  /** 도메인 입력 도우미에 띄울 기존 값들(이 페이지 밖의 것도 포함한다). */
  knownDomains: string[];
}

// --- 저장된 표 설정 ---------------------------------------------------------

function readHidden(raw: unknown): ColumnKey[] | null {
  if (!Array.isArray(raw)) return null;
  return GRID_COLUMNS.filter((c) => raw.includes(c.key)).map((c) => c.key);
}

function readWidths(raw: unknown): Partial<Record<ColumnKey, number>> | null {
  if (raw === null || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const out: Partial<Record<ColumnKey, number>> = {};
  for (const col of GRID_COLUMNS) {
    const value = source[col.key];
    if (typeof value === "number" && Number.isFinite(value)) out[col.key] = clampColumnWidth(value);
  }
  return out;
}

function readDensity(raw: unknown): Density | null {
  return isDensity(raw) ? raw : null;
}

/**
 * 표 설정(숨긴 열·너비·밀도)은 사람마다 다르고 서버에 남길 이유가 없다.
 * 첫 렌더는 반드시 기본값으로 그린다 — localStorage를 렌더 중에 읽으면
 * 서버 HTML과 달라져 hydration이 깨진다.
 */
function useStoredPref<T>(key: string, initial: T, read: (raw: unknown) => T | null) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const parsed = read(JSON.parse(raw));
      if (parsed !== null) setValue(parsed);
    } catch {
      // 저장소를 못 읽어도 기본 설정으로 동작한다.
    }
  }, [key, read]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 설정을 저장 못 해도 이번 세션에는 그대로 적용된다.
      }
    },
    [key],
  );

  return [value, update] as const;
}

export function TermsGrid(props: TermsGridProps) {
  const router = useRouter();

  const [rows, setRows] = useState(props.rows);
  // 저장 요청은 비동기라 콜백이 실행될 때의 rows를 클로저로 잡으면 이미 낡았다.
  // 리비전(낙관적 동시성의 기준값)을 낡은 값으로 보내면 멀쩡한 편집이 409가 된다.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const [hidden, setHidden] = useStoredPref<ColumnKey[]>(HIDDEN_KEY, defaultHiddenColumns(), readHidden);
  const [widths, setWidths] = useStoredPref<Partial<Record<ColumnKey, number>>>(WIDTH_KEY, {}, readWidths);
  const [density, setDensity] = useStoredPref<Density>(DENSITY_KEY, "normal", readDensity);

  const [menu, setMenu] = useState<"columns" | "density" | "export" | "help" | null>(null);
  // 머리글 우클릭 메뉴. column이 null이면 머리글의 빈 자리를 누른 것이라 열
  // 목록만 보여준다(정렬·이 열 숨기기는 가리키는 열이 없다).
  const [headerMenu, setHeaderMenu] = useState<{ column: GridColumn | null; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<{ anchor: CellRef; focus: CellRef } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  // 클릭 한 번으로 다음 셀이 열리게 되면서 "편집기가 두 번 겹치는 찰나"가
  // 생겼다 — 이전 편집기의 blur가 뒤늦게 도착해 방금 연 편집기를 닫아 버리거나,
  // 반대로 이전 입력이 저장되지 않고 사라진다. 어느 좌표를 편집 중인지는 렌더를
  // 기다리지 않고 즉시 읽을 수 있어야 해서 ref로도 들고 있는다.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failedRows, setFailedRows] = useState<ReadonlySet<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [undoStack, setUndoStack] = useState<Batch[]>([]);
  const [redoStack, setRedoStack] = useState<Batch[]>([]);
  const [drag, setDrag] = useState<"select" | "fill" | null>(null);
  const [resizing, setResizing] = useState<{ key: ColumnKey; width: number } | null>(null);
  const [scrolledX, setScrolledX] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [draft, setDraft] = useState({ nameEn: "", nameKo: "" });
  const [creating, setCreating] = useState(false);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const toastSeq = useRef(0);

  const columns = useMemo(() => visibleColumns(hidden), [hidden]);
  const range: CellRange | null = sel ? normalizeRange(sel.anchor, sel.focus) : null;
  const rowH = DENSITY_ROW_PX[density];

  // 서버에서 새 목록이 오면(검색/정렬/페이지 이동, router.refresh) 그대로 갈아탄다.
  // 편집 중이던 좌표와 실패 표시는 다른 행을 가리키게 되므로 함께 버린다.
  useEffect(() => {
    setRows(props.rows);
    editingRef.current = null;
    setEditing(null);
    setSel(null);
    setPicked(new Set());
    setFailedRows(new Set());
  }, [props.rows]);

  // 상대 시간은 렌더 시각에 따라 값이 달라져서 SSR 결과와 hydration 결과가
  // 어긋난다("방금" vs "1분 전"). 첫 렌더는 양쪽 다 ISO 날짜로 그리고, 마운트
  // 후에만 상대 시간으로 바꾼다.
  useEffect(() => setNow(new Date()), []);

  // R133: 메뉴 안을 눌러도 닫히면 안 된다. mousedown에서 무조건 닫으면 mouseup
  // 전에 항목이 사라져 click도 change도 아예 발생하지 않는다 — 열 체크박스를
  // 눌러도 아무 일이 없던 원인이 이것이었다. 메뉴 밖에서 눌렀을 때만 닫는다.
  useEffect(() => {
    if (!menu && !headerMenu) return;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-menu-root]")) return;
      setMenu(null);
      setHeaderMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setHeaderMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, headerMenu]);

  useEffect(() => {
    if (!drag) return;
    const stop = () => setDrag(null);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, [drag]);

  // 활성 셀로 포커스를 옮긴다. 셀마다 ref를 두는 대신 좌표를 data 속성으로 두고
  // 찾는다 — 행 목록이 갈릴 때마다 ref 맵을 정리할 필요가 없다.
  useEffect(() => {
    if (!sel || editing) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-cell="${sel.focus.r}:${sel.focus.c}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel, editing]);

  function widthOf(col: GridColumn): number {
    if (resizing?.key === col.key) return resizing.width;
    return widths[col.key] ?? col.width;
  }

  function pushToast(toast: Omit<Toast, "id">) {
    const id = (toastSeq.current += 1);
    // 화면을 오류로 덮지 않도록 최근 몇 개만 남긴다.
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    // 경합(409)은 사용자가 새로고침을 누를 때까지 남아 있어야 한다.
    if (!toast.refresh) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    }
  }

  function markBusy(ids: readonly string[], on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /**
   * 계획된 변경을 실제로 저장한다. 화면에는 먼저 반영하고(낙관적) 실패한 행만
   * 되돌린다 — 한 칸 고칠 때마다 왕복을 기다리면 연속 입력이 불가능하다.
   *
   * expectedRevision을 항상 함께 보낸다. 여럿이 같이 쓰는 사전이라 같은 행을
   * 동시에 고치는 일이 실제로 일어나고, 그때 조용히 덮어쓰는 대신 409를 받는다.
   */
  async function commit(plan: WritePlan, label: string, mode: CommitMode = "edit") {
    for (const message of plan.errors) pushToast({ tone: "error", text: message });
    if (plan.updates.length === 0) return;

    // 낙관적 갱신 전에 원본을 붙잡아 둔다. 되돌릴 값도, 보낼 리비전도 여기서 나온다.
    const before = new Map(rowsRef.current.map((r) => [r.id, r]));
    const inverse: RowPatch[] = [];
    for (const update of plan.updates) {
      const row = before.get(update.rowId);
      if (row) inverse.push({ rowId: row.id, patch: inversePatch(row, update.patch) });
    }

    const patches = new Map(plan.updates.map((u) => [u.rowId, u.patch]));
    const ids = plan.updates.map((u) => u.rowId);
    setRows((prev) => prev.map((r) => (patches.has(r.id) ? applyPatch(r, patches.get(r.id) ?? {}) : r)));
    setFailedRows((prev) => new Set([...prev].filter((id) => !patches.has(id))));
    markBusy(ids, true);

    const failed = new Set<string>();
    const saved = new Set<string>();

    async function send(update: RowPatch) {
      const row = before.get(update.rowId);
      if (!row) return;
      try {
        const res = await fetch(`/api/v1/terms/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...update.patch, expectedRevision: row.revision }),
        });
        if (res.ok) {
          saved.add(row.id);
          return;
        }
        failed.add(row.id);
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (res.status === 409) {
          pushToast({
            tone: "conflict",
            text: `${rowLabel(row)}: 다른 사람이 먼저 수정했습니다.`,
            refresh: true,
          });
        } else {
          pushToast({
            tone: "error",
            text: `${rowLabel(row)}: ${body?.error?.message ?? `저장하지 못했습니다 (${res.status}).`}`,
          });
        }
      } catch {
        failed.add(row.id);
        pushToast({ tone: "error", text: `${rowLabel(row)}: 네트워크 오류로 저장하지 못했습니다.` });
      }
    }

    for (let i = 0; i < plan.updates.length; i += CONCURRENCY) {
      await Promise.all(plan.updates.slice(i, i + CONCURRENCY).map(send));
    }

    const at = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => {
        if (failed.has(r.id)) return before.get(r.id) ?? r;
        if (!saved.has(r.id)) return r;
        // 성공했다는 건 방금 보낸 expectedRevision이 서버의 현재 값이었다는
        // 뜻이므로, 새 리비전 번호는 그 다음 값이다(응답에는 리비전이 없다).
        return { ...r, revision: r.revision + 1, updatedAt: at, editorName: props.viewerName };
      }),
    );
    setFailedRows((prev) => new Set([...prev, ...failed]));
    markBusy(ids, false);

    const undoable = inverse.filter((e) => saved.has(e.rowId));
    if (undoable.length === 0) return;
    const batch: Batch = { label, entries: undoable };
    if (mode === "undo") {
      setRedoStack((prev) => [...prev, batch].slice(-UNDO_LIMIT));
    } else {
      setUndoStack((prev) => [...prev, batch].slice(-UNDO_LIMIT));
      if (mode === "edit") setRedoStack([]);
    }
  }

  function undo() {
    const batch = undoStack[undoStack.length - 1];
    if (!batch) return;
    setUndoStack((prev) => prev.slice(0, -1));
    void commit({ updates: batch.entries, errors: [], cells: batch.entries.length }, batch.label, "undo");
  }

  function redo() {
    const batch = redoStack[redoStack.length - 1];
    if (!batch) return;
    setRedoStack((prev) => prev.slice(0, -1));
    void commit({ updates: batch.entries, errors: [], cells: batch.entries.length }, batch.label, "redo");
  }

  // --- 표 전체에 걸친 동작 --------------------------------------------------

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
        pushToast({ tone: "error", text: body?.error?.message ?? `추가하지 못했습니다 (${res.status}).` });
        return;
      }
      setDraft({ nameEn: "", nameKo: "" });
      draftRef.current?.focus();
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  function bulkStatus(status: string) {
    const targets = rows.filter((r) => picked.has(r.id));
    const column = columns.find((c) => c.key === "status") ?? GRID_COLUMNS.find((c) => c.key === "status");
    if (!column) return;
    const merged: WritePlan = { updates: [], errors: [], cells: 0 };
    for (const row of targets) {
      const plan = planCell(row, column, status);
      merged.updates.push(...plan.updates);
      merged.errors.push(...plan.errors);
      merged.cells += plan.cells;
    }
    void commit(merged, `${targets.length}개 상태 변경`);
  }

  async function deletePicked() {
    const targets = rows.filter((r) => picked.has(r.id));
    markBusy(targets.map((r) => r.id), true);
    for (const row of targets) {
      const res = await fetch(`/api/v1/terms/${row.id}`, { method: "DELETE" });
      if (!res.ok) pushToast({ tone: "error", text: `${rowLabel(row)}: 삭제하지 못했습니다 (${res.status}).` });
    }
    setPicked(new Set());
    router.refresh();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ tone: "ok", text: "클립보드에 복사했습니다." });
    } catch {
      pushToast({ tone: "error", text: "클립보드를 쓸 수 없습니다." });
    }
  }

  function downloadCsv() {
    const target = picked.size ? rows.filter((r) => picked.has(r.id)) : rows;
    // 엑셀은 BOM이 없으면 UTF-8 CSV의 한글을 깨뜨린다.
    const blob = new Blob(["﻿", toCsv(target, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grossary-${isoDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleColumn(key: ColumnKey) {
    const next = toggleHiddenColumn(hidden, key);
    // 마지막 한 열까지 숨기려는 경우다 — 빈 표가 되므로 그대로 둔다.
    if (next === null) return;
    setHidden(next);
    // 열이 사라지면 선택 좌표(열 번호)가 다른 열을 가리키게 된다.
    setSel(null);
  }

  function openHeaderMenu(event: React.MouseEvent, column: GridColumn | null) {
    event.preventDefault();
    setMenu(null);
    setHeaderMenu({ column, x: event.clientX, y: event.clientY });
  }

  function autoWidth(key: ColumnKey) {
    const next = { ...widths };
    delete next[key];
    setWidths(next);
  }

  function startResize(event: React.MouseEvent, col: GridColumn) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(col);
    let last = startWidth;

    // 드래그 중에는 localStorage에 쓰지 않는다(mousemove마다 직렬화가 돈다).
    const onMove = (e: MouseEvent) => {
      last = clampColumnWidth(startWidth + e.clientX - startX);
      setResizing({ key: col.key, width: last });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(null);
      setWidths({ ...widths, [col.key]: last });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    setResizing({ key: col.key, width: startWidth });
  }

  // --- 셀 편집 --------------------------------------------------------------

  function selectCell(r: number, c: number, extend: boolean) {
    if (rows.length === 0 || columns.length === 0) return;
    const nr = Math.min(rows.length - 1, Math.max(0, r));
    const nc = Math.min(columns.length - 1, Math.max(0, c));
    setSel((prev) =>
      extend && prev ? { anchor: prev.anchor, focus: { r: nr, c: nc } } : { anchor: { r: nr, c: nc }, focus: { r: nr, c: nc } },
    );
  }

  function beginEdit(r: number, c: number, seed?: string) {
    const column = columns[c];
    const row = rows[r];
    if (!column || !row || column.kind === "readonly") return;
    const next = { r, c, value: seed ?? cellText(row, column.key) };
    editingRef.current = next;
    setEditing(next);
  }

  function isEditingCell(r: number, c: number): boolean {
    const cur = editingRef.current;
    return cur !== null && cur.r === r && cur.c === c;
  }

  function closeEdit(): void {
    editingRef.current = null;
    setEditing(null);
  }

  function saveCell(r: number, c: number, value: string) {
    const column = columns[c];
    const row = rows[r];
    if (column && row) void commit(planCell(row, column, value), `${column.label} 수정`);
  }

  /**
   * 다른 셀을 열기 직전에 지금 열려 있는 편집기를 저장한다. 편집기는 셀 안에
   * 렌더되므로 새 셀의 편집을 시작하면 그대로 언마운트되는데, 그때는 blur가
   * 오지 않아 입력한 값이 통째로 사라진다.
   */
  function flushEdit() {
    const cur = editingRef.current;
    if (!cur) return;
    closeEdit();
    saveCell(cur.r, cur.c, cur.value);
  }

  function commitEdit(r: number, c: number, value: string, next: "down" | "right" | null) {
    // 이미 다른 셀로 넘어간 뒤 도착한 blur는 무시한다 — 그대로 처리하면 방금
    // 연 편집기를 닫고 선택까지 옛 셀로 되돌린다.
    if (!isEditingCell(r, c)) return;
    closeEdit();
    saveCell(r, c, value);
    if (next === "down") selectCell(r + 1, c, false);
    else if (next === "right") selectCell(r, c + 1, false);
    else selectCell(r, c, false);
  }

  function clearRange() {
    if (!range) return;
    void commit(planClear(rows, columns, range), `${rangeCells(range)}칸 비우기`);
  }

  function fillDown() {
    if (!range || range.r0 === range.r1) return;
    void commit(planFill(rows, columns, range), "아래로 채우기");
  }

  function onKeyDown(event: React.KeyboardEvent, r: number, c: number) {
    if (editing) return;
    const column = columns[c];
    const row = rows[r];
    if (!column || !row) return;

    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    const lastRow = rows.length - 1;
    const lastCol = columns.length - 1;

    if (mod && key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key.toLowerCase() === "a") {
      event.preventDefault();
      setSel({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } });
      return;
    }
    if (mod && key.toLowerCase() === "d") {
      event.preventDefault();
      fillDown();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const dr = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
      const dc = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      // Ctrl+방향키는 엑셀처럼 그 방향 끝으로 뛴다.
      const target = mod
        ? { r: dr === 0 ? r : dr > 0 ? lastRow : 0, c: dc === 0 ? c : dc > 0 ? lastCol : 0 }
        : { r: r + dr, c: c + dc };
      selectCell(target.r, target.c, event.shiftKey);
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      selectCell(r + (key === "PageDown" ? 10 : -10), c, event.shiftKey);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      const toCol = key === "Home" ? 0 : lastCol;
      selectCell(mod ? (key === "Home" ? 0 : lastRow) : r, toCol, event.shiftKey);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      selectCell(r, c + (event.shiftKey ? -1 : 1), false);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      selectCell(r, c, false);
      return;
    }
    if (key === " " && event.shiftKey) {
      event.preventDefault();
      togglePick(row.id);
      return;
    }
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      beginEdit(r, c);
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      clearRange();
      return;
    }
    // 엑셀처럼, 그냥 타이핑하면 그 글자로 편집이 시작된다.
    if (key.length === 1 && !mod && !event.altKey) {
      event.preventDefault();
      beginEdit(r, c, column.kind === "enum" ? undefined : key);
    }
  }

  /**
   * 복사/붙여넣기는 키 조합을 가로채는 대신 브라우저의 clipboard 이벤트에
   * 얹는다 — navigator.clipboard.readText()는 권한 프롬프트가 뜨거나 아예 막히는
   * 브라우저가 있는데, paste 이벤트의 clipboardData는 어디서나 그냥 읽힌다.
   */
  function onCopy(event: React.ClipboardEvent) {
    if (editing || !range) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", rangeToTsv(rows, columns, range));
  }

  function onPaste(event: React.ClipboardEvent) {
    if (editing || !sel) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const matrix = parseClipboardMatrix(text);
    if (matrix.length === 0) return;

    const anchor = { r: Math.min(sel.anchor.r, sel.focus.r), c: Math.min(sel.anchor.c, sel.focus.c) };
    const plan = planPaste(rows, columns, anchor, matrix);
    void commit(plan, `${plan.cells}칸 붙여넣기`);

    const height = Math.min(matrix.length, rows.length - anchor.r) - 1;
    const width = Math.min(Math.max(...matrix.map((m) => m.length)), columns.length - anchor.c) - 1;
    setSel({ anchor, focus: { r: anchor.r + Math.max(0, height), c: anchor.c + Math.max(0, width) } });
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPicked = rows.length > 0 && picked.size === rows.length;
  const frozenKey = columns[0]?.key;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GridToolbar
        columns={columns}
        hidden={hidden}
        density={density}
        menu={menu}
        setMenu={setMenu}
        onToggleColumn={toggleColumn}
        onDensity={setDensity}
        onResetWidths={() => setWidths({})}
        onCsv={downloadCsv}
        onCopyAll={() => void copyText(toTsv(picked.size ? rows.filter((r) => picked.has(r.id)) : rows, columns))}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={undo}
        onRedo={redo}
      />

      <div
        className="min-h-0 flex-1 overflow-auto"
        onCopy={onCopy}
        onPaste={onPaste}
        onScroll={(e) => {
          const left = e.currentTarget.scrollLeft > 0;
          setScrolledX((prev) => (prev === left ? prev : left));
        }}
      >
        <table
          className={cx(
            "w-max min-w-full table-fixed border-separate border-spacing-0 text-[13px]",
            resizing && "select-none",
          )}
        >
          <colgroup>
            <col style={{ width: GUTTER_W }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c) }} />
            ))}
            {/* 열 너비 합이 화면보다 좁을 때 남는 자리를 먹는 칸. 없으면 마지막
                열이 늘어나 사용자가 정한 너비가 무시된다. */}
            <col />
          </colgroup>

          <thead>
            <tr style={{ height: 34 }}>
              <th
                onContextMenu={(e) => openHeaderMenu(e, null)}
                className="sticky left-0 top-0 z-40 border-b border-r border-line-strong bg-panel-2 px-2"
                style={scrolledX ? { boxShadow: "6px 0 8px -8px rgb(0 0 0 / 0.45)" } : undefined}
              >
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allPicked}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="h-3.5 w-3.5 accent-brand"
                />
              </th>

              {columns.map((col) => (
                <HeaderCell
                  key={col.key}
                  column={col}
                  frozen={col.key === frozenKey}
                  scrolledX={scrolledX}
                  sortHrefs={props.sortHrefs}
                  sortState={props.sortState}
                  resizing={resizing?.key === col.key}
                  onResizeStart={(e) => startResize(e, col)}
                  onAutoWidth={() => autoWidth(col.key)}
                  onContextMenu={(e) => openHeaderMenu(e, col)}
                />
              ))}

              <th
                onContextMenu={(e) => openHeaderMenu(e, null)}
                className="sticky top-0 z-30 border-b border-grid bg-panel-2"
              />
            </tr>
          </thead>

          <tbody ref={bodyRef}>
            {rows.map((row, r) => {
              const isPicked = picked.has(row.id);
              const isBusy = busy.has(row.id);
              const isFailed = failedRows.has(row.id);

              return (
                <tr key={row.id} className="group" style={{ height: rowH }}>
                  <td
                    className={cx(
                      "sticky left-0 z-20 border-b border-r border-line-strong px-2 align-middle",
                      isFailed ? "bg-danger-soft" : isPicked ? "bg-brand-soft" : "bg-panel group-hover:bg-panel-2",
                    )}
                    style={scrolledX ? { boxShadow: "6px 0 8px -8px rgb(0 0 0 / 0.45)" } : undefined}
                  >
                    <span className="flex items-center justify-between gap-1">
                      {/* 평소에는 행 번호, 마우스를 올리거나 고른 줄에서는 체크박스.
                          체크박스가 50줄 내내 켜져 있으면 표가 양식처럼 보인다. */}
                      <span className="relative grid h-4 w-6 place-items-center">
                        <span
                          className={cx(
                            "font-mono text-[10px] tabular-nums text-ink-3 transition-opacity group-hover:opacity-0",
                            isPicked && "opacity-0",
                          )}
                        >
                          {props.rowOffset + r + 1}
                        </span>
                        <input
                          type="checkbox"
                          aria-label={`${rowLabel(row)} 선택`}
                          checked={isPicked}
                          onChange={() => togglePick(row.id)}
                          className={cx(
                            "absolute h-3.5 w-3.5 accent-brand transition-opacity",
                            !isPicked && "opacity-0 group-hover:opacity-100",
                          )}
                        />
                      </span>

                      {isBusy ? (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" title="저장 중" />
                      ) : isFailed ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-danger" title="저장 실패" />
                      ) : (
                        <Link
                          href={`/terms/${row.slug}`}
                          title="용어 페이지 열기"
                          className="text-ink-3 opacity-0 transition hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <IconExpand />
                        </Link>
                      )}
                    </span>
                  </td>

                  {columns.map((col, c) => {
                    const isEditing = editing?.r === r && editing?.c === c;
                    const isActive = sel?.focus.r === r && sel?.focus.c === c;
                    const inSel = range !== null && inRange(range, r, c);
                    const frozen = col.key === frozenKey;

                    return (
                      <td
                        key={col.key}
                        data-cell={`${r}:${c}`}
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          // 이 셀의 편집기 안에서 시작한 클릭(도메인 후보 칩)은
                          // 셀을 누른 게 아니다.
                          if (isEditingCell(r, c)) return;
                          flushEdit();
                          selectCell(r, c, e.shiftKey);
                          // 종류·상태·정의는 여기서 바로 열린다. Shift+클릭은
                          // 범위 선택이라 예외다.
                          if (!e.shiftKey && opensOnClick(col)) {
                            // mousedown의 기본 동작은 누른 칸(tabIndex=-1이라
                            // 포커스를 받는다)으로 포커스를 옮기는 것이다. 그대로
                            // 두면 방금 뜬 편집기가 곧바로 blur돼서 목록이 열리는
                            // 즉시 닫힌다 — 더블클릭이 되던 이유도 dblclick에는
                            // 포커스 기본 동작이 없어서였다.
                            e.preventDefault();
                            beginEdit(r, c);
                            return;
                          }
                          setDrag("select");
                        }}
                        onMouseEnter={() => {
                          if (drag === "select") selectCell(r, c, true);
                          else if (drag === "fill" && sel) setSel({ anchor: sel.anchor, focus: { r, c: sel.focus.c } });
                        }}
                        onDoubleClick={() => {
                          // 이미 열린 편집기 안에서의 더블클릭(단어 선택)까지
                          // 편집 시작으로 받으면 입력하던 값이 되감긴다.
                          if (!isEditingCell(r, c)) beginEdit(r, c);
                        }}
                        onKeyDown={(e) => onKeyDown(e, r, c)}
                        className={cx(
                          "group/cell relative border-b border-r border-grid px-2 align-middle outline-none",
                          frozen && "sticky z-10",
                          // 활성 셀은 이웃 위로 떠야 테두리가 잘리지 않지만,
                          // 고정된 머리글(z-30/40)보다는 낮아야 세로로 스크롤할 때
                          // 머리글을 뚫고 올라오지 않는다.
                          isEditing || isActive
                            ? "z-20 bg-panel"
                            : inSel
                              ? "bg-brand-soft"
                              : isFailed
                                ? "bg-danger-soft/60"
                                : isPicked
                                  ? "bg-brand-soft/45"
                                  : col.kind === "readonly"
                                    ? "bg-panel-2/45 text-ink-3 group-hover:bg-panel-2"
                                    : "bg-panel group-hover:bg-panel-2/70",
                        )}
                        style={{
                          ...(frozen ? { left: GUTTER_W } : null),
                          boxShadow: cellShadow(range, r, c, isActive === true, frozen && scrolledX),
                        }}
                      >
                        {/* 종류·상태의 편집기는 셀 밖에 뜨는 목록이라 칸 자체는
                            비어 버린다. 고르는 동안 원래 값이 사라지면 "뭘 바꾸는
                            중인지"가 화면에서 지워지므로 밑에 그대로 깔아 둔다. */}
                        {(!isEditing || col.kind === "enum") && (
                          <CellView row={row} column={col} now={now} query={props.query} />
                        )}

                        {isEditing && (
                          <CellEditor
                            column={col}
                            value={editing.value}
                            knownDomains={props.knownDomains}
                            onChange={(v) => {
                              const next = { r, c, value: v };
                              editingRef.current = next;
                              setEditing(next);
                            }}
                            onCommit={(value, next) => commitEdit(r, c, value, next)}
                            onCancel={() => {
                              if (!isEditingCell(r, c)) return;
                              closeEdit();
                              selectCell(r, c, false);
                            }}
                          />
                        )}

                        {/* 채우기 손잡이. 아래로 끌면 이 값이 그 줄들에 복사된다. */}
                        {isActive && !isEditing && col.kind !== "readonly" && (
                          <span
                            role="presentation"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDrag("fill");
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title="아래로 끌어 채우기"
                            className="absolute -bottom-[3px] -right-[3px] z-40 h-[7px] w-[7px] cursor-crosshair rounded-[1px] bg-brand ring-1 ring-panel"
                          />
                        )}
                      </td>
                    );
                  })}

                  <td
                    className={cx(
                      "border-b border-grid",
                      isFailed ? "bg-danger-soft/60" : isPicked ? "bg-brand-soft/45" : "bg-panel group-hover:bg-panel-2/70",
                    )}
                  />
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="border-b border-grid bg-panel px-4 py-16 text-center">
                  <p className="text-sm text-ink-2">조건에 맞는 용어가 없습니다.</p>
                  <p className="mt-1 text-xs text-ink-3">
                    아래 줄에 이름을 적으면 바로 만들어집니다. 엑셀에서 복사해 붙여넣어도 됩니다.
                  </p>
                </td>
              </tr>
            )}

            {/* 엑셀의 마지막 빈 줄. 여기에 이름을 적고 Enter를 누르면 그대로 새
                용어가 만들어진다 — "새로 만들기" 화면을 거치지 않아도 표 안에서
                목록이 자란다. */}
            <tr style={{ height: rowH }}>
              <td
                className="sticky left-0 z-20 border-b border-r border-line-strong bg-panel-2/60 text-center text-ink-3"
                style={scrolledX ? { boxShadow: "6px 0 8px -8px rgb(0 0 0 / 0.45)" } : undefined}
              >
                +
              </td>
              <td colSpan={columns.length + 1} className="border-b border-grid bg-panel-2/40 px-2">
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    ref={draftRef}
                    value={draft.nameEn}
                    onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && void createFromDraft()}
                    placeholder="새 용어 영문명"
                    className="h-7 w-48 rounded-md border border-line bg-panel px-2 text-[13px] placeholder:text-ink-3 focus:border-brand focus:outline-none"
                  />
                  <input
                    value={draft.nameKo}
                    onChange={(e) => setDraft({ ...draft, nameKo: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && void createFromDraft()}
                    placeholder="국문명"
                    className="h-7 w-40 rounded-md border border-line bg-panel px-2 text-[13px] placeholder:text-ink-3 focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => void createFromDraft()}
                    disabled={creating || (!draft.nameEn.trim() && !draft.nameKo.trim())}
                  >
                    추가
                  </button>
                  <span className="text-[11px] text-ink-3">Enter로 계속 추가할 수 있습니다</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <StatusBar
        rowCount={rows.length}
        pickedCount={picked.size}
        range={range}
        busyCount={busy.size}
        canDelete={props.canDelete}
        onBulkStatus={bulkStatus}
        onCopyPicked={() => void copyText(toTsv(rows.filter((r) => picked.has(r.id)), columns))}
        onDelete={() => void deletePicked()}
        onClearPick={() => setPicked(new Set())}
      />

      {headerMenu && (
        <HeaderMenu
          column={headerMenu.column}
          x={headerMenu.x}
          y={headerMenu.y}
          hidden={hidden}
          canHide={columns.length > 1}
          sortDirHrefs={props.sortDirHrefs}
          sortState={props.sortState}
          onToggleColumn={toggleColumn}
          onAutoWidth={autoWidth}
          onResetWidths={() => setWidths({})}
          onShowAll={() => {
            setHidden([]);
            setSel(null);
          }}
          onClose={() => setHeaderMenu(null)}
        />
      )}

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-16 right-5 z-50 flex flex-col items-end gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                "pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-pop animate-fade-up",
                t.tone === "conflict"
                  ? "border-warn/35 bg-warn-soft text-warn"
                  : t.tone === "ok"
                    ? "border-ok/35 bg-ok-soft text-ok"
                    : "border-danger/35 bg-danger-soft text-danger",
              )}
            >
              <span className="min-w-0 flex-1">{t.text}</span>
              {t.refresh ? (
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => router.refresh()}>
                  새로고침
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="닫기"
                  className="shrink-0 opacity-60 hover:opacity-100"
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 활성 셀의 두꺼운 테두리와 선택 영역의 바깥선을 한 번에 만든다. 테두리를
 * border로 그리면 선 두께만큼 칸이 밀려 표 전체가 1px씩 흔들린다 — inset
 * 그림자는 자리를 차지하지 않는다.
 */
function cellShadow(
  range: CellRange | null,
  r: number,
  c: number,
  active: boolean,
  frozenShadow: boolean,
): string | undefined {
  const parts: string[] = [];
  if (range && rangeCells(range) > 1 && inRange(range, r, c)) {
    if (r === range.r0) parts.push("inset 0 1px 0 0 rgb(var(--selection))");
    if (r === range.r1) parts.push("inset 0 -1px 0 0 rgb(var(--selection))");
    if (c === range.c0) parts.push("inset 1px 0 0 0 rgb(var(--selection))");
    if (c === range.c1) parts.push("inset -1px 0 0 0 rgb(var(--selection))");
  }
  if (active) parts.push("inset 0 0 0 2px rgb(var(--selection))");
  if (frozenShadow) parts.push("6px 0 8px -8px rgb(0 0 0 / 0.45)");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// --- 도구 막대 --------------------------------------------------------------

const SHORTCUTS: Array<[string, string]> = [
  ["↑ ↓ ← →", "셀 이동 (Ctrl+방향키: 끝으로)"],
  ["Shift+방향키", "범위 선택 (드래그도 같음)"],
  ["클릭", "종류·상태·정의·본문은 한 번에 편집 시작"],
  ["Enter · F2", "편집 시작 / 그냥 입력해도 시작 (더블클릭도 같음)"],
  ["Tab", "저장하고 오른쪽 칸으로"],
  ["Esc", "편집 취소"],
  ["Ctrl+C / Ctrl+V", "범위 복사 / 엑셀에서 붙여넣기"],
  ["Ctrl+D", "선택 영역 맨 윗값으로 아래 채우기"],
  ["Delete", "선택 영역 비우기"],
  ["Ctrl+A", "전체 셀 선택"],
  ["Ctrl+Z / Ctrl+Shift+Z", "되돌리기 / 다시하기"],
  ["Shift+Space", "그 줄을 선택 목록에 넣기"],
];

function GridToolbar(props: {
  columns: readonly GridColumn[];
  hidden: ColumnKey[];
  density: Density;
  menu: "columns" | "density" | "export" | "help" | null;
  setMenu: (m: "columns" | "density" | "export" | "help" | null) => void;
  onToggleColumn: (key: ColumnKey) => void;
  onDensity: (d: Density) => void;
  onResetWidths: () => void;
  onCsv: () => void;
  onCopyAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  // 메뉴는 바깥 클릭으로 닫힌다(문서 리스너). 여기서 전파를 막지 않으면
  // 메뉴를 여는 클릭이 곧바로 닫기 리스너에 잡힌다.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    // relative z-50: 여기서 열리는 메뉴는 표 위로 펼쳐진다. 도구 막대가 쌓임
    // 맥락을 만들지 않으면 아래로 펼쳐진 메뉴가 고정된 열 머리글에 가려진다.
    <div
      className="relative z-50 flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-xs"
      onMouseDown={stop}
    >
      <button
        type="button"
        className="btn-quiet btn-sm gap-1"
        onClick={props.onUndo}
        disabled={!props.canUndo}
        title="되돌리기 (Ctrl+Z)"
      >
        <IconUndo />
        되돌리기
      </button>
      <button
        type="button"
        className="btn-quiet btn-sm gap-1"
        onClick={props.onRedo}
        disabled={!props.canRedo}
        title="다시하기 (Ctrl+Shift+Z)"
      >
        <IconUndo flip />
        다시
      </button>

      <span className="mx-1 h-4 w-px bg-line" />

      <span className="hidden text-ink-3 md:inline">
        엑셀에서 복사한 범위를 <span className="kbd">Ctrl</span>
        <span className="kbd ml-0.5">V</span>로 그대로 붙여넣을 수 있습니다
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <Menu
          label={`${DENSITY_LABEL[props.density]} 밀도`}
          open={props.menu === "density"}
          onToggle={() => props.setMenu(props.menu === "density" ? null : "density")}
          width="w-36"
        >
          {DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => props.onDensity(d)}
              className={cx(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-panel-2",
                props.density === d ? "text-brand" : "text-ink-2",
              )}
            >
              <span className="w-3">{props.density === d ? "•" : ""}</span>
              {DENSITY_LABEL[d]}
            </button>
          ))}
          <span className="my-1 block h-px bg-line" />
          <button
            type="button"
            onClick={props.onResetWidths}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-panel-2"
          >
            열 너비 초기화
          </button>
        </Menu>

        <Menu
          label={`열 ${props.columns.length}/${GRID_COLUMNS.length}`}
          open={props.menu === "columns"}
          onToggle={() => props.setMenu(props.menu === "columns" ? null : "columns")}
          width="w-44"
        >
          {GRID_COLUMNS.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-panel-2"
            >
              <input
                type="checkbox"
                checked={!props.hidden.includes(col.key)}
                onChange={() => props.onToggleColumn(col.key)}
                className="h-3.5 w-3.5 accent-brand"
              />
              {col.label}
            </label>
          ))}
        </Menu>

        <Menu
          label="내보내기"
          open={props.menu === "export"}
          onToggle={() => props.setMenu(props.menu === "export" ? null : "export")}
          width="w-48"
        >
          <button
            type="button"
            onClick={props.onCsv}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-panel-2"
          >
            CSV 파일로 저장
            <span className="mt-0.5 block text-[10px] text-ink-3">엑셀에서 바로 열립니다</span>
          </button>
          <button
            type="button"
            onClick={props.onCopyAll}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-panel-2"
          >
            표로 클립보드에 복사
            <span className="mt-0.5 block text-[10px] text-ink-3">시트에 그대로 붙여넣기</span>
          </button>
        </Menu>

        <Menu
          label="?"
          open={props.menu === "help"}
          onToggle={() => props.setMenu(props.menu === "help" ? null : "help")}
          width="w-80"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-ink">단축키</p>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-baseline gap-2 rounded px-2 py-1 text-[11px]">
              <span className="w-40 shrink-0 font-mono text-ink-3">{keys}</span>
              <span className="text-ink-2">{what}</span>
            </div>
          ))}
        </Menu>
      </div>
    </div>
  );
}

function Menu({
  label,
  open,
  onToggle,
  width,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  width: string;
  children: React.ReactNode;
}) {
  return (
    // data-menu-root: 바깥을 눌렀을 때만 닫히게 하는 표식(R133). 이게 없으면
    // 메뉴 안의 항목이 mouseup 전에 사라져 눌러도 아무 일이 일어나지 않는다.
    <div className="relative" data-menu-root>
      <button type="button" className={cx("btn-ghost btn-sm", open && "border-brand/45 text-ink")} onClick={onToggle}>
        {label}
      </button>
      {open && (
        <div className={cx("absolute right-0 z-50 mt-1 rounded-lg border border-line bg-panel p-1 shadow-pop", width)}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 머리글 우클릭 메뉴. 열 목록은 툴바에도 있지만, 표를 훑다가 "이 열은 치우고
 * 싶다"고 느끼는 자리는 언제나 그 열의 머리글이다 — 거기서 바로 닿아야 한다.
 */
function HeaderMenu({
  column,
  x,
  y,
  hidden,
  canHide,
  sortDirHrefs,
  sortState,
  onToggleColumn,
  onAutoWidth,
  onResetWidths,
  onShowAll,
  onClose,
}: {
  column: GridColumn | null;
  x: number;
  y: number;
  hidden: ColumnKey[];
  canHide: boolean;
  sortDirHrefs: Partial<Record<SortKey, { asc: string; desc: string }>>;
  sortState: { key: SortKey; dir: SortDir };
  onToggleColumn: (key: ColumnKey) => void;
  onAutoWidth: (key: ColumnKey) => void;
  onResetWidths: () => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 커서 자리에 그대로 두면 오른쪽 끝 열이나 창 아래쪽에서 잘린다. 항목 수에
  // 따라 높이가 달라져 상수로는 못 맞추므로 그린 뒤 실제 크기를 재서 접는다.
  // useLayoutEffect라 페인트 전에 자리가 잡혀 메뉴가 튀어 보이지 않는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPos(
      clampMenuPosition(
        { x, y },
        { w: box.width, h: box.height },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    );
  }, [x, y]);

  const sort = column?.sortKey ? sortDirHrefs[column.sortKey] : undefined;
  const sortedHere = column?.sortKey !== undefined && column.sortKey === sortState.key;

  return (
    <div
      ref={ref}
      data-menu-root
      role="menu"
      className="fixed z-50 w-52 rounded-lg border border-line bg-panel p-1 shadow-pop"
      style={{ left: pos.x, top: pos.y }}
    >
      {column && (
        <>
          <p className="truncate px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink">{column.label}</p>

          {sort && (
            <>
              <Link
                href={sort.asc}
                scroll={false}
                onClick={onClose}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-panel-2"
              >
                <span className="w-3 text-brand">{sortedHere && sortState.dir === "asc" ? "•" : ""}</span>
                오름차순 정렬
              </Link>
              <Link
                href={sort.desc}
                scroll={false}
                onClick={onClose}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-panel-2"
              >
                <span className="w-3 text-brand">{sortedHere && sortState.dir === "desc" ? "•" : ""}</span>
                내림차순 정렬
              </Link>
            </>
          )}

          <MenuAction
            onClick={() => {
              onToggleColumn(column.key);
              onClose();
            }}
            disabled={!canHide}
            title={canHide ? undefined : "마지막 남은 열은 숨길 수 없습니다"}
          >
            이 열 숨기기
          </MenuAction>
          <MenuAction
            onClick={() => {
              onAutoWidth(column.key);
              onClose();
            }}
          >
            열 너비 기본값
          </MenuAction>

          <span className="my-1 block h-px bg-line" />
        </>
      )}

      <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink">열 보이기</p>
      {/* 여러 열을 연달아 켜고 끌 수 있어야 하므로 열을 켜고 끄는 자리(체크박스와
          아래의 "모든 열 보이기")는 메뉴를 닫지 않는다. 어느 열이 켜졌는지
          그 자리에서 바로 보이기도 한다. */}
      <div className="max-h-64 overflow-auto">
        {GRID_COLUMNS.map((col) => (
          <label
            key={col.key}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-panel-2"
          >
            <input
              type="checkbox"
              checked={!hidden.includes(col.key)}
              onChange={() => onToggleColumn(col.key)}
              className="h-3.5 w-3.5 accent-brand"
            />
            <span className="truncate">{col.label}</span>
          </label>
        ))}
      </div>

      <span className="my-1 block h-px bg-line" />
      <MenuAction onClick={onShowAll} disabled={hidden.length === 0}>
        모든 열 보이기
      </MenuAction>
      <MenuAction
        onClick={() => {
          onResetWidths();
          onClose();
        }}
      >
        열 너비 초기화
      </MenuAction>
    </div>
  );
}

function MenuAction({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent"
    >
      <span className="w-3" />
      {children}
    </button>
  );
}

// --- 상태 막대 --------------------------------------------------------------

function StatusBar(props: {
  rowCount: number;
  pickedCount: number;
  range: CellRange | null;
  busyCount: number;
  canDelete: boolean;
  onBulkStatus: (status: string) => void;
  onCopyPicked: () => void;
  onDelete: () => void;
  onClearPick: () => void;
}) {
  const cells = props.range ? rangeCells(props.range) : 0;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-panel px-3 py-1.5 text-[11px]">
      <span className="text-ink-3">
        <span className="font-medium text-ink-2">{props.rowCount}</span>행
      </span>

      {cells > 1 && props.range && (
        <span className="text-ink-3">
          선택 {props.range.r1 - props.range.r0 + 1} × {props.range.c1 - props.range.c0 + 1}
          <span className="ml-1 text-ink-3/70">({cells}칸)</span>
        </span>
      )}

      {props.busyCount > 0 && (
        <span className="flex items-center gap-1.5 text-brand">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
          {props.busyCount}줄 저장 중
        </span>
      )}

      {props.pickedCount > 0 && (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-ink">{props.pickedCount}줄 선택</span>
          <select
            className="h-6 rounded-md border border-line bg-panel px-1.5 text-[11px] text-ink-2 focus:border-brand focus:outline-none"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              e.target.value = "";
              if (value) props.onBulkStatus(value);
            }}
          >
            <option value="">상태 일괄 변경…</option>
            {TERM_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TERM_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost btn-sm" onClick={props.onCopyPicked}>
            표로 복사
          </button>
          {props.canDelete && (
            <button type="button" className="btn-danger btn-sm" onClick={props.onDelete}>
              삭제
            </button>
          )}
          <button type="button" className="btn-quiet btn-sm" onClick={props.onClearPick}>
            해제
          </button>
        </span>
      )}
    </div>
  );
}

// --- 머리글 / 셀 ------------------------------------------------------------

function HeaderCell({
  column,
  frozen,
  scrolledX,
  sortHrefs,
  sortState,
  resizing,
  onResizeStart,
  onAutoWidth,
  onContextMenu,
}: {
  column: GridColumn;
  frozen: boolean;
  scrolledX: boolean;
  sortHrefs: Partial<Record<SortKey, string>>;
  sortState: { key: SortKey; dir: SortDir };
  resizing: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  onAutoWidth: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const href = column.sortKey ? sortHrefs[column.sortKey] : undefined;
  const on = column.sortKey !== undefined && column.sortKey === sortState.key;

  const inner = (
    <>
      <span className="truncate">{column.label}</span>
      {/* 정렬 가능한 열은 마우스를 올렸을 때 화살표 자리를 미리 보여준다 —
          "여기를 누르면 정렬된다"는 걸 눌러 보기 전에 알 수 있어야 한다. */}
      {on ? (
        <span className="ml-auto shrink-0 text-[10px]">{sortState.dir === "asc" ? "▲" : "▼"}</span>
      ) : href ? (
        <span className="ml-auto shrink-0 text-[10px] opacity-0 transition group-hover/th:opacity-60">▲</span>
      ) : null}
    </>
  );

  return (
    <th
      scope="col"
      onContextMenu={onContextMenu}
      className={cx(
        "group/th sticky top-0 border-b bg-panel-2 px-2 text-left text-[11px] font-semibold",
        frozen ? "z-40 border-r border-line-strong" : "z-30 border-r border-grid",
        on ? "border-b-brand text-brand" : "border-b-line-strong text-ink-2",
      )}
      style={{
        ...(frozen ? { left: GUTTER_W } : null),
        ...(frozen && scrolledX ? { boxShadow: "6px 0 8px -8px rgb(0 0 0 / 0.45)" } : null),
      }}
    >
      {href ? (
        <Link
          href={href}
          scroll={false}
          // 우클릭은 메뉴를 여는 동작이다. 막지 않으면 브라우저에 따라 링크가
          // 따라가 정렬이 바뀐 채로 메뉴가 열린다.
          onContextMenu={onContextMenu}
          className="flex items-center gap-1 hover:text-ink"
        >
          {inner}
        </Link>
      ) : (
        <span className="flex items-center gap-1">{inner}</span>
      )}

      <span
        role="presentation"
        onMouseDown={onResizeStart}
        onDoubleClick={onAutoWidth}
        title="끌어서 너비 조절 · 더블클릭하면 기본값"
        className={cx(
          "absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize",
          resizing ? "bg-brand/60" : "hover:bg-brand/40",
        )}
      />
    </th>
  );
}

/** 검색어와 겹치는 부분을 표시한다. 왜 이 줄이 걸렸는지 눈으로 찾게 만든다. */
function highlight(text: string, query: string | undefined) {
  if (!query) return text;
  const needle = query.trim().toLowerCase();
  if (needle === "") return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-brand-soft px-0.5 text-brand">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function CellView({
  row,
  column,
  now,
  query,
}: {
  row: TermRow;
  column: GridColumn;
  now: Date | null;
  query: string | undefined;
}) {
  if (column.key === "updatedAt") {
    const at = new Date(row.updatedAt);
    return (
      <span className="flex items-center gap-1.5 leading-tight">
        <span className="text-[11px] text-ink-2">{now ? relativeTime(at, now) : isoDate(at)}</span>
        {row.editorName && (
          <span
            title={`마지막 수정: ${row.editorName}`}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-panel-2 text-[9px] font-semibold text-ink-3"
          >
            {row.editorName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
    );
  }

  if (column.key === "status") {
    return (
      <PickCell>
        <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS_TONE[row.status])}>
          {TERM_STATUS_LABEL[row.status]}
        </span>
      </PickCell>
    );
  }

  if (column.key === "termType") {
    return (
      <PickCell>
        <span className="text-[12px] text-ink-2">{TERM_TYPE_LABEL[row.termType]}</span>
      </PickCell>
    );
  }

  if (column.key === "domain") {
    if (row.domain.length === 0) return null;
    // 좁은 칸에서 칩이 잘려 반쯤 보이는 것보다, 몇 개 더 있는지 세어 주는 편이 낫다.
    const shown = row.domain.slice(0, 2);
    const rest = row.domain.length - shown.length;
    return (
      <span className="flex items-center gap-1 overflow-hidden">
        {shown.map((d) => (
          <span key={d} className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-2">
            {d}
          </span>
        ))}
        {rest > 0 && <span className="shrink-0 text-[10px] text-ink-3">+{rest}</span>}
      </span>
    );
  }

  const text = cellText(row, column.key);
  return (
    <span className={cx("block truncate", column.mono ? "font-mono text-[11px] text-ink-3" : "text-ink")}>
      {highlight(text, query)}
    </span>
  );
}

/**
 * 종류·상태 셀. 값 오른쪽에 삼각형이 뜬다 — 마우스를 올리기 전까지 이 칸이
 * 목록에서 고르는 칸인지 알 방법이 없었고, 몰라서 안 고치는 칸은 없는 칸이다.
 * 평소에 계속 떠 있으면 표 전체가 양식처럼 보이므로 그 셀에 올렸을 때만 보인다.
 */
function PickCell({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className="min-w-0 truncate">{children}</span>
      <IconCaret className="ml-auto shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/cell:opacity-100" />
    </span>
  );
}

// --- 편집기 -----------------------------------------------------------------

/**
 * 셀 밖으로 펼쳐지는 편집기를 어느 쪽으로 열지 실제로 재서 정한다. 판단
 * 자체는 opensUp에 있고, 여기서는 잴 것만 잰다 — 아래로 편 상태에서의 높이,
 * 셀의 위치, 그리고 실제로 잘라내는 상자.
 */
function useOpensUp(ref: React.RefObject<HTMLElement | null>): boolean {
  const [up, setUp] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    const cell = el?.offsetParent;
    if (!el || !(cell instanceof HTMLElement)) return;
    setUp(opensUp(el.getBoundingClientRect().height, cell.getBoundingClientRect(), clipBounds(el)));
  }, [ref]);

  return up;
}

/** 편집기를 실제로 잘라내는 상자. 표의 스크롤 영역이거나, 없으면 뷰포트다. */
function clipBounds(el: HTMLElement): Bounds {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
      const rect = p.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

function CellEditor({
  column,
  value,
  knownDomains,
  onChange,
  onCommit,
  onCancel,
}: {
  column: GridColumn;
  value: string;
  knownDomains: string[];
  onChange: (v: string) => void;
  onCommit: (value: string, move: "down" | "right" | null) => void;
  onCancel: () => void;
}) {
  if (column.kind === "enum") {
    return <EnumEditor column={column} value={value} onPick={(v) => onCommit(v, null)} onCancel={onCancel} />;
  }

  if (column.kind === "list") {
    return (
      <ListEditor
        value={value}
        knownDomains={knownDomains}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  if (column.kind === "longtext") {
    return <LongTextEditor value={value} onChange={onChange} onCommit={onCommit} onCancel={onCancel} />;
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value, null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onCommit(e.currentTarget.value, "down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onCommit(e.currentTarget.value, "right");
        }
      }}
      className="absolute inset-0 h-full w-full rounded-none border-0 bg-panel px-2 text-[13px] text-ink outline-none ring-2 ring-brand"
    />
  );
}

/**
 * 정의·본문은 한 줄 입력창에 넣으면 앞 30자 말고는 볼 수가 없다. 칸 밖으로
 * 펼쳐지는 세 줄짜리 상자로 띄우고, 줄바꿈은 Shift+Enter로 넣는다(Enter는 저장).
 */
function LongTextEditor({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (value: string, move: "down" | "right" | null) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const openUp = useOpensUp(ref);

  return (
    <textarea
      ref={ref}
      autoFocus
      rows={3}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value, null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(e.currentTarget.value, "down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onCommit(e.currentTarget.value, "right");
        }
      }}
      className={cx(
        "absolute left-0 z-40 w-[max(100%,24rem)] resize-none rounded-md bg-panel px-2 py-1.5 text-[13px]",
        "leading-snug text-ink shadow-pop outline-none ring-2 ring-brand",
        openUp ? "bottom-0" : "top-0",
      )}
    />
  );
}

/**
 * 종류·상태는 값이 몇 개 안 되므로 네이티브 select 대신 목록을 직접 그린다 —
 * 상태 색을 후보에도 그대로 보여줄 수 있고, 방향키+Enter로 손이 키보드를
 * 떠나지 않는다(표 편집 중에 마우스로 옮겨가는 게 제일 느리다).
 */
function EnumEditor({
  column,
  value,
  onPick,
  onCancel,
}: {
  column: GridColumn;
  value: string;
  onPick: (v: string) => void;
  onCancel: () => void;
}) {
  const options = column.options ?? [];
  const [index, setIndex] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const ref = useRef<HTMLDivElement>(null);
  const openUp = useOpensUp(ref);

  useEffect(() => ref.current?.focus(), []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setIndex((i) => Math.min(options.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const option = options[index];
          if (option) onPick(option.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={cx(
        "absolute left-0 z-40 min-w-[9rem] rounded-lg border border-line bg-panel p-1 shadow-pop outline-none",
        openUp ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      {options.map((option, i) => {
        const tone = statusTone(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              // 이 mousedown이 셀까지 올라가면, 셀이 "클릭했으니 열어라"로 받아
              // 방금 고른 목록이 곧바로 다시 열린다.
              e.stopPropagation();
              onPick(option.value);
            }}
            className={cx(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              i === index ? "bg-brand-soft text-brand" : "text-ink-2",
            )}
          >
            {tone !== null && <span className={cx("h-2 w-2 shrink-0 rounded-full", tone)} />}
            <span className="truncate">{option.label}</span>
            {option.value === value && <span className="ml-auto shrink-0 text-[10px] text-ink-3">현재</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 도메인은 자유 입력이라 오타가 곧 새 도메인이 된다. 쓰던 값을 눌러 넣게 한다. */
function ListEditor({
  value,
  knownDomains,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  knownDomains: string[];
  onChange: (v: string) => void;
  onCommit: (value: string, move: "down" | "right" | null) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openUp = useOpensUp(popRef);
  const tokens = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function toggle(domain: string) {
    const next = tokens.includes(domain) ? tokens.filter((t) => t !== domain) : [...tokens, domain];
    onChange(next.join(", "));
    // 칩을 누르면 포커스가 버튼으로 옮겨간다. 돌려놓지 않으면 두 번째 칩을 고를
    // 때마다 입력창을 다시 클릭해야 하고, Enter로 저장할 수도 없다.
    inputRef.current?.focus();
  }

  return (
    <>
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          // 아래 후보 칩을 누르는 중이면 편집을 닫지 않는다.
          if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset.domainChip === "1") return;
          onCommit(e.currentTarget.value, null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onCommit(e.currentTarget.value, "down");
          } else if (e.key === "Tab") {
            e.preventDefault();
            onCommit(e.currentTarget.value, "right");
          }
        }}
        placeholder="쉼표로 구분"
        className="absolute inset-0 h-full w-full rounded-none border-0 bg-panel px-2 text-[13px] text-ink outline-none ring-2 ring-brand"
      />

      {knownDomains.length > 0 && (
        <div
          ref={popRef}
          className={cx(
            "absolute left-0 z-40 flex max-h-32 w-[max(100%,14rem)] flex-wrap gap-1 overflow-auto rounded-lg",
            "border border-line bg-panel p-1.5 shadow-pop",
            openUp ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {knownDomains.map((d) => (
            <button
              key={d}
              type="button"
              data-domain-chip="1"
              onClick={() => toggle(d)}
              className={cx("chip !py-0.5 !text-[11px]", tokens.includes(d) && "chip-on")}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// --- 아이콘 -----------------------------------------------------------------

function IconCaret({ className }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={className}>
      <path d="M2 4h6L5 7.5z" fill="currentColor" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6.5 9.5 13 3m0 0H9.25M13 3v3.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10.5v1.75A1.75 1.75 0 0 1 10.25 14h-6.5A1.75 1.75 0 0 1 2 12.25v-6.5A1.75 1.75 0 0 1 3.75 4H5.5" strokeLinecap="round" />
    </svg>
  );
}

function IconUndo({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
      className={flip ? "-scale-x-100" : undefined}
    >
      <path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 4 3 6.5 5.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
