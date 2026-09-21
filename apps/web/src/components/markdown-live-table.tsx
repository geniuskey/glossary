"use client";

import { useEffect, useRef, useState, type DragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

export interface LiveTableModel {
  headers: string[];
  alignments: string[];
  rows: string[][];
}

type DropPosition = "before" | "after";
interface DropTarget {
  index: number;
  position: DropPosition;
}
interface TableContextMenu {
  rowIndex?: number;
  columnIndex?: number;
  x: number;
  y: number;
}

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function normalizeAlignment(value: string): string {
  const cell = value.trim();
  if (/^:-+:$/.test(cell)) return ":---:";
  if (/^:-+$/.test(cell)) return ":---";
  if (/^-+:$/.test(cell)) return "---:";
  return "---";
}

export function parseLiveTable(source: string): LiveTableModel | null {
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = splitTableRow(lines[0]!);
  const separator = splitTableRow(lines[1]!);
  if (headers.length < 2 || separator.length < 2 || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;

  const columnCount = Math.max(headers.length, separator.length);
  const normalizedHeaders = Array.from({ length: columnCount }, (_, index) => headers[index] ?? `열 ${index + 1}`);
  const alignments = Array.from({ length: columnCount }, (_, index) => normalizeAlignment(separator[index] ?? "---"));
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
  });
  return { headers: normalizedHeaders, alignments, rows };
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ").trim();
}

export function serializeLiveTable(model: LiveTableModel): string {
  const row = (cells: string[]) => `| ${cells.map(escapeTableCell).join(" | ")} |`;
  return [
    row(model.headers),
    row(model.alignments),
    ...model.rows.map(row),
  ].join("\n");
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

function moveColumn(model: LiveTableModel, from: number, to: number): LiveTableModel {
  return {
    headers: moveItem(model.headers, from, to),
    alignments: moveItem(model.alignments, from, to),
    rows: model.rows.map((row) => moveItem(row, from, to)),
  };
}

function moveRow(model: LiveTableModel, from: number, to: number): LiveTableModel {
  return { ...model, rows: moveItem(model.rows, from, to) };
}

function insertionIndex(index: number, position: DropPosition, from: number): number {
  const target = position === "before" ? index : index + 1;
  return from < target ? target - 1 : target;
}

function dropPosition(event: DragEvent<HTMLElement>, axis: "x" | "y"): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  const pointer = axis === "x" ? event.clientX : event.clientY;
  const start = axis === "x" ? bounds.left : bounds.top;
  const size = axis === "x" ? bounds.width : bounds.height;
  return pointer < start + size / 2 ? "before" : "after";
}

export function LivePreviewTable({ source, onChange }: { source: string; onChange: (source: string) => void }) {
  const model = parseLiveTable(source);
  const [draggedColumn, setDraggedColumn] = useState<number | null>(null);
  const [dropColumn, setDropColumn] = useState<DropTarget | null>(null);
  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const [dropRow, setDropRow] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<TableContextMenu | null>(null);
  const emptyModel: LiveTableModel = { headers: [], alignments: [], rows: [] };
  const [draft, setDraft] = useState<LiveTableModel>(model ?? emptyModel);
  const draftRef = useRef<LiveTableModel>(model ?? emptyModel);
  const dirtyRef = useRef(false);
  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!model) return;
    draftRef.current = model;
    dirtyRef.current = false;
    setDraft(model);
  }, [source]);

  useEffect(() => {
    if (!contextMenu) return;
    const frame = requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus());
    const closeFromOutside = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setContextMenu(null);
      requestAnimationFrame(() => contextTriggerRef.current?.focus());
    };
    const closeFromViewport = () => setContextMenu(null);
    document.addEventListener("pointerdown", closeFromOutside, true);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", closeFromViewport);
    window.addEventListener("scroll", closeFromViewport, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeFromOutside, true);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", closeFromViewport);
      window.removeEventListener("scroll", closeFromViewport, true);
    };
  }, [contextMenu]);

  if (!model) return <pre className="cm-live-table-fallback"><code>{source}</code></pre>;
  const table = draft;

  function setDraftModel(next: LiveTableModel, dirty = true) {
    draftRef.current = next;
    dirtyRef.current = dirty;
    setDraft(next);
  }

  function apply(next: LiveTableModel) {
    const serialized = serializeLiveTable(next);
    if (serialized === source) return;
    draftRef.current = next;
    dirtyRef.current = false;
    onChange(serialized);
  }

  function commitDraft() {
    if (!dirtyRef.current) return;
    apply(draftRef.current);
  }

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    const current = draftRef.current;
    const next: LiveTableModel = {
      ...current,
      headers: rowIndex < 0 ? current.headers.map((cell, index) => index === columnIndex ? value : cell) : current.headers,
      rows: rowIndex < 0
        ? current.rows
        : current.rows.map((row, index) => index === rowIndex
          ? row.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell)
          : row),
    };
    setDraftModel(next);
  }

  function cellKey(rowIndex: number, columnIndex: number) {
    return `${rowIndex}:${columnIndex}`;
  }

  function registerCell(rowIndex: number, columnIndex: number, element: HTMLInputElement | null) {
    const key = cellKey(rowIndex, columnIndex);
    if (element) cellRefs.current.set(key, element);
    else cellRefs.current.delete(key);
  }

  function focusCell(rowIndex: number, columnIndex: number) {
    requestAnimationFrame(() => {
      const input = cellRefs.current.get(cellKey(rowIndex, columnIndex));
      input?.focus();
      input?.select();
    });
  }

  function cellFromIndex(index: number, columnCount: number) {
    if (index < columnCount) return { rowIndex: -1, columnIndex: index };
    const bodyIndex = index - columnCount;
    return { rowIndex: Math.floor(bodyIndex / columnCount), columnIndex: bodyIndex % columnCount };
  }

  function cellIndex(rowIndex: number, columnIndex: number, columnCount: number) {
    return rowIndex < 0 ? columnIndex : columnCount + rowIndex * columnCount + columnIndex;
  }

  function handleCellKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    if (openContextMenuFromKeyboard(event, { rowIndex: rowIndex < 0 ? undefined : rowIndex, columnIndex })) return;
    if (event.key !== "Tab" && event.key !== "Enter") return;
    const columnCount = draftRef.current.headers.length;
    if (columnCount === 0) return;

    const currentIndex = cellIndex(rowIndex, columnIndex, columnCount);
    const totalCells = columnCount + draftRef.current.rows.length * columnCount;
    let nextIndex = event.key === "Enter"
      ? (rowIndex < 0 ? columnCount + columnIndex : currentIndex + columnCount)
      : currentIndex + (event.shiftKey ? -1 : 1);

    if (nextIndex < 0) return;
    if (nextIndex >= totalCells) {
      const next = { ...draftRef.current, rows: [...draftRef.current.rows, draftRef.current.headers.map(() => "")] };
      setDraftModel(next);
    }

    event.preventDefault();
    const nextCell = cellFromIndex(nextIndex, columnCount);
    focusCell(nextCell.rowIndex, nextCell.columnIndex);
  }

  function openContextMenu(target: Omit<TableContextMenu, "x" | "y">, x: number, y: number, trigger: HTMLElement) {
    contextTriggerRef.current = trigger;
    setContextMenu({
      ...target,
      x: Math.max(8, Math.min(x, window.innerWidth - 184)),
      y: Math.max(8, Math.min(y, window.innerHeight - 112)),
    });
  }

  function openContextMenuFromPointer(event: ReactMouseEvent<HTMLElement>, target: Omit<TableContextMenu, "x" | "y">) {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(target, event.clientX, event.clientY, event.currentTarget);
  }

  function openContextMenuFromKeyboard(event: ReactKeyboardEvent<HTMLElement>, target: Omit<TableContextMenu, "x" | "y">): boolean {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    openContextMenu(target, bounds.left + Math.min(bounds.width, 24), bounds.top + Math.min(bounds.height, 24), event.currentTarget);
    return true;
  }

  function deleteColumn(index: number) {
    const current = draftRef.current;
    if (current.headers.length <= 2) return;
    setContextMenu(null);
    contextTriggerRef.current = null;
    apply({
      headers: current.headers.filter((_, columnIndex) => columnIndex !== index),
      alignments: current.alignments.filter((_, columnIndex) => columnIndex !== index),
      rows: current.rows.map((row) => row.filter((_, columnIndex) => columnIndex !== index)),
    });
  }

  function deleteRow(index: number) {
    const current = draftRef.current;
    setContextMenu(null);
    contextTriggerRef.current = null;
    apply({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index) });
  }

  function handleTableBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    commitDraft();
  }

  function handleColumnDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedColumn(index);
  }

  function handleColumnDrop(event: DragEvent<HTMLTableCellElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedColumn !== null) {
      const position = dropPosition(event, "x");
      apply(moveColumn(draftRef.current, draggedColumn, insertionIndex(index, position, draggedColumn)));
    }
    setDraggedColumn(null);
    setDropColumn(null);
  }

  function handleColumnKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (openContextMenuFromKeyboard(event, { columnIndex: index })) return;
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const target = index + (event.key === "ArrowLeft" ? -1 : 1);
    if (target < 0 || target >= draftRef.current.headers.length) return;
    event.preventDefault();
    event.stopPropagation();
    apply(moveColumn(draftRef.current, index, target));
  }

  function handleRowDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedRow(index);
  }

  function handleRowDrop(event: DragEvent<HTMLTableRowElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedRow !== null) {
      const position = dropPosition(event, "y");
      apply(moveRow(draftRef.current, draggedRow, insertionIndex(index, position, draggedRow)));
    }
    setDraggedRow(null);
    setDropRow(null);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (openContextMenuFromKeyboard(event, { rowIndex: index })) return;
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= draftRef.current.rows.length) return;
    event.preventDefault();
    event.stopPropagation();
    apply(moveRow(draftRef.current, index, target));
  }

  function addRow() {
    const current = draftRef.current;
    apply({ ...current, rows: [...current.rows, current.headers.map(() => "")] });
  }

  function addColumn() {
    const current = draftRef.current;
    apply({
      headers: [...current.headers, `열 ${current.headers.length + 1}`],
      alignments: [...current.alignments, "---"],
      rows: current.rows.map((row) => [...row, ""]),
    });
  }

  return (
    <div className="markdown-body cm-live-preview-block-content cm-live-table-shell" onBlur={handleTableBlur}>
      <div className="cm-live-table-scroll">
        <table className="cm-live-table">
          <thead>
            <tr>
              <th className="cm-live-table-control-column" aria-hidden="true" />
              {table.headers.map((header, index) => (
                <th
                  key={`header-${index}`}
                  data-live-table-control="true"
                  className={`cm-live-table-column-header${dropColumn?.index === index ? ` cm-live-table-drop-target cm-live-table-column-drop-${dropColumn.position}` : ""}${draggedColumn === index ? " cm-live-table-column-dragging" : ""}`}
                  onDragOver={(event) => {
                    if (draggedColumn !== null) {
                      event.preventDefault();
                      setDropColumn({ index, position: dropPosition(event, "x") });
                    }
                  }}
                  onDragLeave={() => setDropColumn(null)}
                  onDrop={(event) => handleColumnDrop(event, index)}
                  >
                  <button
                    type="button"
                    draggable
                    data-live-table-control="true"
                    className="cm-live-table-column-handle"
                    aria-label={`${header || `열 ${index + 1}`} 열 순서 변경`}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    title="드래그하거나 Alt+←/→로 열 순서 변경"
                    onDragStart={(event) => handleColumnDragStart(event, index)}
                    onDragEnd={() => { setDraggedColumn(null); setDropColumn(null); }}
                    onKeyDown={(event) => handleColumnKeyDown(event, index)}
                    onContextMenu={(event) => openContextMenuFromPointer(event, { columnIndex: index })}
                  >
                    ⠿
                  </button>
                  <input
                    type="text"
                    className="cm-live-table-cell-input"
                    data-live-table-cell="true"
                    aria-label={`${index + 1}번째 열 이름`}
                    value={header}
                    onChange={(event) => updateCell(-1, index, event.currentTarget.value)}
                    onKeyDown={(event) => handleCellKeyDown(event, -1, index)}
                    onContextMenu={(event) => openContextMenuFromPointer(event, { columnIndex: index })}
                    ref={(element) => registerCell(-1, index, element)}
                    placeholder={`열 ${index + 1}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr
                key={`row-${rowIndex}`}
                className={`cm-live-table-row${dropRow?.index === rowIndex ? ` cm-live-table-drop-row cm-live-table-row-drop-${dropRow.position}` : ""}`}
                onDragOver={(event) => {
                  if (draggedRow !== null) {
                    event.preventDefault();
                    setDropRow({ index: rowIndex, position: dropPosition(event, "y") });
                  }
                }}
                onDragLeave={() => setDropRow(null)}
                onDrop={(event) => handleRowDrop(event, rowIndex)}
              >
                <td className="cm-live-table-control-column cm-live-table-row-handle-cell">
                  <button
                    type="button"
                    draggable
                    data-live-table-control="true"
                    className={`cm-live-table-row-handle${draggedRow === rowIndex ? " cm-live-table-row-handle-active" : ""}`}
                    aria-label={`${rowIndex + 1}번째 행 순서 변경`}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    title="드래그하거나 Alt+↑/↓로 행 순서 변경"
                    onDragStart={(event) => handleRowDragStart(event, rowIndex)}
                    onDragEnd={() => { setDraggedRow(null); setDropRow(null); }}
                    onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                    onContextMenu={(event) => openContextMenuFromPointer(event, { rowIndex })}
                  >
                    ⠿
                  </button>
                </td>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${rowIndex}-${cellIndex}`}
                    className={dropColumn?.index === cellIndex ? `cm-live-table-column-drop-${dropColumn.position}` : undefined}
                  >
                    <input
                      type="text"
                      className="cm-live-table-cell-input"
                      data-live-table-cell="true"
                      aria-label={`${rowIndex + 1}행 ${cellIndex + 1}열`}
                      value={cell}
                      onChange={(event) => updateCell(rowIndex, cellIndex, event.currentTarget.value)}
                      onKeyDown={(event) => handleCellKeyDown(event, rowIndex, cellIndex)}
                      onContextMenu={(event) => openContextMenuFromPointer(event, { rowIndex, columnIndex: cellIndex })}
                      ref={(element) => registerCell(rowIndex, cellIndex, element)}
                      placeholder="내용"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          data-live-table-control="true"
          className="cm-live-table-add-column"
          aria-label="열 추가"
          title="뒤에 열 추가하기"
          onClick={addColumn}
        >
          +
        </button>
      </div>
      <button
        type="button"
        data-live-table-control="true"
        className="cm-live-table-add-row"
        aria-label="행 추가"
        title="뒤에 행 추가하기"
        onClick={addRow}
      >
        +
      </button>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="표 편집 메뉴"
          data-live-table-control="true"
          className="fixed z-[120] min-w-44 rounded-lg border border-line bg-panel p-1 shadow-pop"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.rowIndex !== undefined && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
              onClick={() => deleteRow(contextMenu.rowIndex!)}
            >
              행 삭제
            </button>
          )}
          {contextMenu.columnIndex !== undefined && (
            <button
              type="button"
              role="menuitem"
              aria-disabled={table.headers.length <= 2}
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 aria-disabled:cursor-not-allowed aria-disabled:text-ink-3 aria-disabled:hover:bg-transparent"
              title={table.headers.length <= 2 ? "Markdown 표에는 열이 최소 2개 필요합니다" : undefined}
              onClick={() => deleteColumn(contextMenu.columnIndex!)}
            >
              {table.headers.length <= 2 ? "열 삭제 불가 · 최소 2개" : "열 삭제"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
