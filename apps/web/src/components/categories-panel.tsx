"use client";

import { useMemo, useRef, useState } from "react";
import type { ManagedBusinessCategory } from "@/lib/terms/categories";
import { cx } from "@/lib/ui/format";
import { reorderByKey, type DropEdge } from "@/lib/ui/reorder";
import { getRowDragPreview, rowDragOffset, setTableRowDragImage } from "@/lib/ui/table-row-drag";
import { HelpTip } from "./help-tip";

type Message = { kind: "ok" | "bad"; text: string } | null;
type DropTarget = { key: string; edge: DropEdge };

const CATEGORY_DRAG_TYPE = "application/x-glossary-category-order";
const GRID_INPUT_CLASS = "h-7 w-full min-w-0 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-3 focus:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function CategoriesPanel({
  initialCategories,
  initialNewLabel = "",
  isAdmin,
}: {
  initialCategories: ManagedBusinessCategory[];
  initialNewLabel?: string;
  isAdmin: boolean;
}) {
  const [categories, setCategories] = useState(initialCategories);
  const typedInKorean = /[가-힣]/.test(initialNewLabel);
  const [newLabelKo, setNewLabelKo] = useState(typedInKorean ? initialNewLabel : "");
  const [newLabelEn, setNewLabelEn] = useState(typedInKorean ? "" : initialNewLabel);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragRowHeight, setDragRowHeight] = useState(0);
  const draggedKeyRef = useRef<string | null>(null);
  const dragPreview = useMemo(() => getRowDragPreview(
    categories,
    draggedKey,
    dropTarget?.key ?? null,
    dropTarget?.edge ?? null,
    dragRowHeight,
  ), [categories, draggedKey, dropTarget, dragRowHeight]);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const labelKo = newLabelKo.trim();
    const labelEn = newLabelEn.trim();
    if (!labelKo || !labelEn || busyKey) return;
    setBusyKey("__new__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelKo, labelEn }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 추가하지 못했습니다"));
      const body = await response.json() as { category: ManagedBusinessCategory };
      setCategories((current) => [...current, body.category]);
      setNewLabelKo("");
      setNewLabelEn("");
      setMessage({ kind: "ok", text: `‘${body.category.labelKo}’ 업무 분류를 추가했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 추가하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  function editName(key: string, field: "labelKo" | "labelEn", value: string) {
    setCategories((current) => current.map((category) => category.key === key
      ? { ...category, [field]: value, ...(field === "labelKo" ? { label: value } : {}) }
      : category));
    setDirtyKeys((current) => new Set(current).add(key));
    setMessage(null);
  }

  async function saveNames() {
    const pending = categories.filter((category) => dirtyKeys.has(category.key));
    if (pending.length === 0 || pending.some((category) => !category.labelKo.trim() || !category.labelEn.trim()) || busyKey) return;
    setBusyKey("__names__");
    setMessage(null);
    try {
      const results = await Promise.all(pending.map(async (category) => {
        const labelKo = category.labelKo.trim();
        const labelEn = category.labelEn.trim();
        try {
          const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ labelKo, labelEn }),
          });
          if (!response.ok) throw new Error(await errorMessage(response, "이름을 저장하지 못했습니다"));
          return { key: category.key, labelKo, labelEn, error: null as string | null };
        } catch (error) {
          return { key: category.key, labelKo, labelEn, error: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." };
        }
      }));
      const failures = results.filter((result) => result.error);
      const saved = new Map(results.filter((result) => !result.error).map((result) => [result.key, result]));
      setCategories((current) => current.map((category) => {
        const result = saved.get(category.key);
        return result ? { ...category, label: result.labelKo, labelKo: result.labelKo, labelEn: result.labelEn } : category;
      }));
      setDirtyKeys(new Set(failures.map((result) => result.key)));
      setMessage(failures.length > 0
        ? { kind: "bad", text: failures[0]!.error! }
        : { kind: "ok", text: `업무 분류 이름 ${results.length.toLocaleString("ko-KR")}개를 저장했습니다.` });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveOrder(reordered: ManagedBusinessCategory[]) {
    if (busyKey) return;
    const previous = categories;
    setCategories(reordered.map((category, sortOrder) => ({ ...category, sortOrder })));
    setBusyKey("__order__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: reordered.map((category) => category.key) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "순서를 저장하지 못했습니다"));
    } catch (error) {
      setCategories(previous);
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "순서를 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  function clearDrag() {
    draggedKeyRef.current = null;
    setDraggedKey(null);
    setDropTarget(null);
    setDragRowHeight(0);
  }

  function startDrag(event: React.DragEvent<HTMLButtonElement>, key: string) {
    if (busyKey) {
      event.preventDefault();
      return;
    }
    draggedKeyRef.current = key;
    setDraggedKey(key);
    setDropTarget(null);
    setMessage(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(CATEGORY_DRAG_TYPE, key);
    event.dataTransfer.setData("text/plain", key);
    const row = event.currentTarget.closest("tr");
    if (row) setDragRowHeight(setTableRowDragImage(event.dataTransfer, row));
  }

  function dragOver(event: React.DragEvent<HTMLTableRowElement>, key: string) {
    const sourceKey = draggedKeyRef.current;
    if (!sourceKey || sourceKey === key || busyKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge: DropEdge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropTarget((current) => current?.key === key && current.edge === edge ? current : { key, edge });
  }

  function drop(event: React.DragEvent<HTMLTableRowElement>, targetKey: string) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData(CATEGORY_DRAG_TYPE) || draggedKeyRef.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge: DropEdge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    clearDrag();
    if (!sourceKey || sourceKey === targetKey || busyKey) return;
    const reordered = reorderByKey(categories, sourceKey, targetKey, edge);
    if (reordered.every((category, index) => category.key === categories[index]?.key)) return;
    void saveOrder(reordered);
  }

  async function remove(category: ManagedBusinessCategory) {
    if (busyKey || (!isAdmin && category.usageCount > 0)) return;
    const effect = category.usageCount > 0
      ? `\n연결된 용어 ${category.usageCount.toLocaleString("ko-KR")}개는 미분류로 전환됩니다.`
      : "";
    if (!window.confirm(`‘${category.labelKo}’ 업무 분류를 삭제할까요?${effect}`)) return;
    setBusyKey(category.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 삭제하지 못했습니다"));
      setCategories((current) => current.filter((item) => item.key !== category.key));
      setDirtyKeys((current) => {
        const next = new Set(current);
        next.delete(category.key);
        return next;
      });
      setMessage({ kind: "ok", text: `‘${category.labelKo}’ 업무 분류를 삭제했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 삭제하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section id="business-categories" className="scroll-mt-6" aria-labelledby="categories-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="categories-heading" className="text-base font-semibold text-ink">업무 분류</h2>
        <HelpTip text="누구나 분류를 추가하고 미사용 분류를 삭제할 수 있습니다. 사용 중인 분류의 삭제와 이름·순서 변경은 관리자만 할 수 있습니다. 관리자는 손잡이를 끌어 순서를 바꿀 수 있습니다." />
      </div>

      {message && (
        <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3", message.kind === "bad" ? "note-danger" : "note-ok")}>
          {message.text}
        </p>
      )}

      <form onSubmit={(event) => void addCategory(event)} className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm [&_td]:border [&_td]:border-line [&_th]:border [&_th]:border-line">
          <thead>
            <tr className="bg-panel-2 text-xs text-ink-3">
              <th scope="col" className="w-14 px-2 py-1.5 font-medium">순서</th>
              <th scope="col" className="px-2 py-1.5 font-medium">한글 이름</th>
              <th scope="col" className="px-2 py-1.5 font-medium">English name</th>
              <th scope="col" className="w-16 px-2 py-1.5 text-right font-medium">사용</th>
              <th scope="col" className="w-20 px-2 py-1.5 text-center font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr
                key={category.key}
                onDragOver={isAdmin ? (event) => dragOver(event, category.key) : undefined}
                onDrop={isAdmin ? (event) => drop(event, category.key) : undefined}
                style={draggedKey ? { transform: `translate3d(0, ${rowDragOffset(index, dragPreview)}px, 0)` } : undefined}
                className={cx(
                  "transition-[transform,opacity,background-color] duration-200 ease-out motion-reduce:transition-none hover:bg-panel-2/55",
                  draggedKey && "will-change-transform",
                  draggedKey === category.key && "opacity-0",
                  dropTarget?.key === category.key && dropTarget.edge === "before" && "[&>td]:border-t-2 [&>td]:border-t-brand [&>td]:bg-brand/5",
                  dropTarget?.key === category.key && dropTarget.edge === "after" && "[&>td]:border-b-2 [&>td]:border-b-brand [&>td]:bg-brand/5",
                )}
              >
                <td className="px-2 py-1">
                  {isAdmin ? (
                    <button
                      type="button"
                      draggable={!busyKey}
                      disabled={Boolean(busyKey)}
                      onDragStart={(event) => startDrag(event, category.key)}
                      onDragEnd={clearDrag}
                      className="btn-quiet grid h-6 w-6 cursor-grab place-items-center p-0 active:cursor-grabbing"
                      aria-label={`${category.labelKo} 순서 변경`}
                      title="드래그하여 순서 변경"
                    >
                      <DragHandleIcon />
                    </button>
                  ) : (
                    <span className="font-mono text-xs tabular-nums text-ink-3">{index + 1}</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {isAdmin ? (
                    <input value={category.labelKo} onChange={(event) => editName(category.key, "labelKo", event.target.value)} maxLength={60} disabled={Boolean(busyKey)} aria-label={`${category.key} 한글 이름`} className={GRID_INPUT_CLASS} />
                  ) : <span className="font-medium text-ink">{category.labelKo}</span>}
                </td>
                <td className="px-2 py-1">
                  {isAdmin ? (
                    <input value={category.labelEn} onChange={(event) => editName(category.key, "labelEn", event.target.value)} maxLength={60} disabled={Boolean(busyKey)} aria-label={`${category.key} 영문 이름`} className={GRID_INPUT_CLASS} />
                  ) : <span className="text-ink-2">{category.labelEn}</span>}
                </td>
                <td className="px-2 py-1 text-right font-mono text-xs tabular-nums text-ink-2">{category.usageCount.toLocaleString("ko-KR")}</td>
                <td className="px-2 py-1 text-center">
                  <div className="flex items-center justify-center">
                    {!isAdmin && category.usageCount > 0 ? (
                      <span className="text-xs text-ink-3">관리자만</span>
                    ) : (
                      <button type="button" onClick={() => void remove(category)} disabled={Boolean(busyKey)} className="btn-quiet grid h-7 w-7 place-items-center p-0 text-danger" aria-label={`${category.labelKo} 삭제`} title="삭제"><DeleteIcon /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-panel-2/45">
              <td className="px-2 py-1" />
              <td className="px-2 py-1">
                <label htmlFor="new-category-ko" className="sr-only">새 업무 분류 한글 이름</label>
                <input id="new-category-ko" value={newLabelKo} onChange={(event) => setNewLabelKo(event.target.value)} maxLength={60} required disabled={Boolean(busyKey)} placeholder="예: 보안" className={GRID_INPUT_CLASS} />
              </td>
              <td className="px-2 py-1">
                <label htmlFor="new-category-en" className="sr-only">새 업무 분류 영문 이름</label>
                <input id="new-category-en" value={newLabelEn} onChange={(event) => setNewLabelEn(event.target.value)} maxLength={60} required disabled={Boolean(busyKey)} placeholder="e.g. Security" className={GRID_INPUT_CLASS} />
              </td>
              <td />
              <td className="px-2 py-1 text-center">
                <button type="submit" disabled={!newLabelKo.trim() || !newLabelEn.trim() || Boolean(busyKey)} className="btn-primary btn-sm whitespace-nowrap">추가</button>
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
        {isAdmin && (
          <div className="flex items-center justify-end gap-3 border-t border-line bg-panel px-3 py-2">
            {dirtyKeys.size > 0 && <span className="text-xs text-ink-3">{dirtyKeys.size.toLocaleString("ko-KR")}개 수정됨</span>}
            <button type="button" className="btn-primary btn-sm" disabled={dirtyKeys.size === 0 || categories.some((category) => dirtyKeys.has(category.key) && (!category.labelKo.trim() || !category.labelEn.trim())) || Boolean(busyKey)} onClick={() => void saveNames()}>
              {busyKey === "__names__" ? "저장 중…" : "변경사항 저장"}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

function DragHandleIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="4" r="1.25" /><circle cx="10" cy="4" r="1.25" />
      <circle cx="4" cy="9" r="1.25" /><circle cx="10" cy="9" r="1.25" />
      <circle cx="4" cy="14" r="1.25" /><circle cx="10" cy="14" r="1.25" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4.5h10M6 2.5h4l.5 2H5.5l.5-2Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4.5 4.5.5 9h6l.5-9M6.75 7v4M9.25 7v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
