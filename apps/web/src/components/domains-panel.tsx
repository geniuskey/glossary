"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import type { ManagedDomain } from "@/lib/terms/domains";
import { DOMAIN_COLOR_PALETTE, DOMAIN_COLOR_SETS, domainColorStyle } from "@/lib/terms/domain-colors";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { cx } from "@/lib/ui/format";
import { reorderByKey, type DropEdge } from "@/lib/ui/reorder";
import { getRowDragPreview, rowDragOffset, setTableRowDragImage } from "@/lib/ui/table-row-drag";
import { HelpTip } from "./help-tip";

type Message = { kind: "ok" | "bad"; text: string } | null;
type DropTarget = { key: string; edge: DropEdge };

const DOMAIN_DRAG_TYPE = "application/x-glossary-domain-order";
const GRID_INPUT_CLASS = "h-7 w-full min-w-0 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-3 focus:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function DomainsPanel({
  initialDomains,
  initialNewLabel = "",
  isAdmin,
}: {
  initialDomains: ManagedDomain[];
  initialNewLabel?: string;
  isAdmin: boolean;
}) {
  const [domains, setDomains] = useState(initialDomains);
  const [newLabel, setNewLabel] = useState(initialNewLabel);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [paletteKey, setPaletteKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragRowHeight, setDragRowHeight] = useState(0);
  const draggedKeyRef = useRef<string | null>(null);
  const usedColors = useMemo(() => new Set(domains.map((domain) => domain.color)), [domains]);
  const dragPreview = useMemo(() => getRowDragPreview(
    domains,
    draggedKey,
    dropTarget?.key ?? null,
    dropTarget?.edge ?? null,
    dragRowHeight,
  ), [domains, draggedKey, dropTarget, dragRowHeight]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label || busyKey) return;
    setBusyKey("__new__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "도메인을 추가하지 못했습니다"));
      const body = await response.json() as { domain: ManagedDomain };
      setDomains((current) => [...current, body.domain]);
      setNewLabel("");
      setMessage({ kind: "ok", text: `‘${body.domain.label}’ 도메인을 추가했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "도메인을 추가하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  function editName(key: string, label: string) {
    setDomains((current) => current.map((item) => item.key === key ? { ...item, label } : item));
    setDirtyKeys((current) => new Set(current).add(key));
    setMessage(null);
  }

  async function saveNames() {
    const pending = domains.filter((domain) => dirtyKeys.has(domain.key));
    if (pending.length === 0 || pending.some((domain) => !domain.label.trim()) || busyKey) return;
    setBusyKey("__names__");
    setMessage(null);
    try {
      const results = await Promise.all(pending.map(async (domain) => {
        const label = domain.label.trim();
        try {
          const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label }),
          });
          if (!response.ok) throw new Error(await errorMessage(response, "이름을 저장하지 못했습니다"));
          return { key: domain.key, label, error: null as string | null };
        } catch (error) {
          return { key: domain.key, label, error: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." };
        }
      }));
      const failures = results.filter((result) => result.error);
      const saved = new Map(results.filter((result) => !result.error).map((result) => [result.key, result.label]));
      setDomains((current) => current.map((domain) => saved.has(domain.key) ? { ...domain, label: saved.get(domain.key)! } : domain));
      setDirtyKeys(new Set(failures.map((result) => result.key)));
      setMessage(failures.length > 0
        ? { kind: "bad", text: failures[0]!.error! }
        : { kind: "ok", text: `도메인 이름 ${results.length.toLocaleString("ko-KR")}개와 연결된 용어를 함께 갱신했습니다.` });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveColor(domain: ManagedDomain, color: string) {
    if (busyKey || color === domain.color) {
      setPaletteKey(null);
      return;
    }
    setBusyKey(domain.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "색상을 저장하지 못했습니다"));
      setDomains((current) => current.map((item) => item.key === domain.key ? { ...item, color } : item));
      setPaletteKey(null);
      setMessage({ kind: "ok", text: `‘${domain.label}’ 도메인 색상을 저장했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "색상을 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveOrder(reordered: ManagedDomain[]) {
    if (busyKey) return;
    const previous = domains;
    setDomains(reordered.map((domain, sortOrder) => ({ ...domain, sortOrder })));
    setBusyKey("__order__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/domains", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: reordered.map((domain) => domain.key) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "순서를 저장하지 못했습니다"));
    } catch (error) {
      setDomains(previous);
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
    setPaletteKey(null);
    setMessage(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DOMAIN_DRAG_TYPE, key);
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
    const sourceKey = event.dataTransfer.getData(DOMAIN_DRAG_TYPE) || draggedKeyRef.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge: DropEdge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    clearDrag();
    if (!sourceKey || sourceKey === targetKey || busyKey) return;
    const reordered = reorderByKey(domains, sourceKey, targetKey, edge);
    if (reordered.every((domain, index) => domain.key === domains[index]?.key)) return;
    void saveOrder(reordered);
  }

  async function remove(domain: ManagedDomain) {
    if (busyKey || (!isAdmin && domain.usageCount > 0)) return;
    const effect = domain.usageCount > 0
      ? `\n연결된 용어 ${domain.usageCount.toLocaleString("ko-KR")}개에서 이 도메인이 제거됩니다.`
      : "";
    if (!window.confirm(`‘${domain.label}’ 도메인을 삭제할까요?${effect}`)) return;
    setBusyKey(domain.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "도메인을 삭제하지 못했습니다"));
      setDomains((current) => current.filter((item) => item.key !== domain.key));
      setDirtyKeys((current) => {
        const next = new Set(current);
        next.delete(domain.key);
        return next;
      });
      setMessage({ kind: "ok", text: `‘${domain.label}’ 도메인을 삭제했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "도메인을 삭제하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section aria-labelledby="domains-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="domains-heading" className="text-base font-semibold text-ink">도메인</h2>
        <HelpTip text="용어가 속한 제품·기술·사업 영역입니다. 누구나 추가하고 미사용 항목을 삭제할 수 있으며, 이름·순서·고유 색상과 사용 중 항목 삭제는 관리자만 관리합니다. 관리자는 손잡이를 끌어 순서를 바꿀 수 있습니다." />
      </div>

      {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3", message.kind === "bad" ? "note-danger" : "note-ok")}>{message.text}</p>}

      <form onSubmit={(event) => void add(event)} className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left text-sm [&_td]:border [&_td]:border-line [&_th]:border [&_th]:border-line">
          <thead><tr className="bg-panel-2 text-xs text-ink-3">
            <th className="w-14 px-2 py-1.5 font-medium">순서</th>
            <th className="px-2 py-1.5 font-medium">도메인 이름</th>
            <th className="w-20 px-2 py-1.5 text-center font-medium">색상</th>
            <th className="w-16 px-2 py-1.5 text-right font-medium">사용</th>
            <th className="w-20 px-2 py-1.5 text-center font-medium">관리</th>
          </tr></thead>
          <tbody>
            {domains.map((domain, index) => (
              <Fragment key={domain.key}>
              <tr
                onDragOver={isAdmin ? (event) => dragOver(event, domain.key) : undefined}
                onDrop={isAdmin ? (event) => drop(event, domain.key) : undefined}
                style={draggedKey ? { transform: `translate3d(0, ${rowDragOffset(index, dragPreview)}px, 0)` } : undefined}
                className={cx(
                  "transition-[transform,opacity,background-color] duration-200 ease-out motion-reduce:transition-none hover:bg-panel-2/55",
                  draggedKey && "will-change-transform",
                  draggedKey === domain.key && "opacity-0",
                  dropTarget?.key === domain.key && dropTarget.edge === "before" && "[&>td]:border-t-2 [&>td]:border-t-brand [&>td]:bg-brand/5",
                  dropTarget?.key === domain.key && dropTarget.edge === "after" && "[&>td]:border-b-2 [&>td]:border-b-brand [&>td]:bg-brand/5",
                )}
              >
                <td className="px-2 py-1">{isAdmin ? (
                  <button
                    type="button"
                    draggable={!busyKey}
                    disabled={Boolean(busyKey)}
                    onDragStart={(event) => startDrag(event, domain.key)}
                    onDragEnd={clearDrag}
                    className="btn-quiet grid h-6 w-6 cursor-grab place-items-center p-0 active:cursor-grabbing"
                    aria-label={`${domain.label} 순서 변경`}
                    title="드래그하여 순서 변경"
                  >
                    <DragHandleIcon />
                  </button>
                ) : <span className="font-mono text-xs text-ink-3">{index + 1}</span>}</td>
                <td className="px-2 py-1">{isAdmin
                  ? <input value={domain.label} maxLength={DOMAIN_VALUE_MAX} disabled={Boolean(busyKey)} onChange={(event) => editName(domain.key, event.target.value)} className={GRID_INPUT_CLASS} aria-label={`${domain.key} 이름`} />
                  : <span className="font-medium text-ink">{domain.label}</span>}</td>
                <td className="px-2 py-1 text-center">
                  <button
                    type="button"
                    disabled={!isAdmin || Boolean(busyKey)}
                    aria-label={`${domain.label} 색상 선택`}
                    aria-expanded={paletteKey === domain.key}
                    onClick={() => setPaletteKey((current) => current === domain.key ? null : domain.key)}
                    className="inline-grid h-6 w-9 place-items-center rounded-md border border-line bg-panel transition hover:border-line-strong disabled:cursor-default disabled:opacity-100"
                  >
                    <span className="domain-color-swatch h-4 w-7 rounded-md" style={domainColorStyle(domain.color)} />
                  </button>
                </td>
                <td className="px-2 py-1 text-right font-mono text-xs tabular-nums text-ink-2">{domain.usageCount.toLocaleString("ko-KR")}</td>
                <td className="px-2 py-1"><span className="flex justify-center">
                  {!isAdmin && domain.usageCount > 0
                    ? <span className="text-xs text-ink-3">관리자만</span>
                    : <button type="button" className="btn-quiet grid h-7 w-7 place-items-center p-0 text-danger" disabled={Boolean(busyKey)} onClick={() => void remove(domain)} aria-label={`${domain.label} 삭제`} title="삭제"><DeleteIcon /></button>}
                </span></td>
              </tr>
              {isAdmin && paletteKey === domain.key && (
                <tr className="bg-panel-2/45">
                  <td colSpan={5} className="px-3 py-3">
                    <div className="space-y-2" role="group" aria-label={`${domain.label} 도메인 색상 팔레트`}>
                      {DOMAIN_COLOR_SETS.map((set) => (
                        <div key={set.key} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
                          <p className="text-[11px] font-medium text-ink-3">{set.label}</p>
                          <div className="flex flex-wrap gap-1">
                            {DOMAIN_COLOR_PALETTE.filter((color) => color.set === set.key).map((color) => {
                              const unavailable = usedColors.has(color.key) && color.key !== domain.color;
                              return (
                                <button
                                  key={color.key}
                                  type="button"
                                  disabled={unavailable || Boolean(busyKey)}
                                  aria-label={`${set.label} ${color.key} 색상${unavailable ? " · 다른 도메인에서 사용 중" : ""}`}
                                  aria-pressed={color.key === domain.color}
                                  title={unavailable ? "다른 도메인에서 사용 중" : "이 색상 사용"}
                                  onClick={() => void saveColor(domain, color.key)}
                                  className="grid h-8 w-8 place-items-center rounded-lg border border-transparent transition hover:border-line-strong aria-pressed:border-ink aria-pressed:bg-panel disabled:cursor-not-allowed disabled:opacity-20"
                                >
                                  <span className="domain-color-swatch h-4 w-6 rounded border" style={domainColorStyle(color.key)} />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr className="bg-panel-2/45">
            <td className="px-2 py-1" />
            <td className="px-2 py-1"><label htmlFor="new-domain" className="sr-only">새 도메인 이름</label><input id="new-domain" value={newLabel} maxLength={DOMAIN_VALUE_MAX} required disabled={Boolean(busyKey)} onChange={(event) => setNewLabel(event.target.value)} placeholder="예: IT" className={GRID_INPUT_CLASS} /></td>
            <td />
            <td />
            <td className="px-2 py-1 text-center"><button type="submit" className="btn-primary btn-sm whitespace-nowrap" disabled={!newLabel.trim() || Boolean(busyKey)}>추가</button></td>
          </tr></tfoot>
        </table>
        </div>
        {isAdmin && (
          <div className="flex items-center justify-end gap-3 border-t border-line bg-panel px-3 py-2">
            {dirtyKeys.size > 0 && <span className="text-xs text-ink-3">{dirtyKeys.size.toLocaleString("ko-KR")}개 수정됨</span>}
            <button type="button" className="btn-primary btn-sm" disabled={dirtyKeys.size === 0 || domains.some((domain) => dirtyKeys.has(domain.key) && !domain.label.trim()) || Boolean(busyKey)} onClick={() => void saveNames()}>
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
