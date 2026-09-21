"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { WorkspaceMenuKey } from "@glossary/db";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";
import { moveWorkspaceMenu, WORKSPACE_MENU_OPTIONS } from "@/lib/workspace/menu-settings-values";
import type { ResolvedWorkspaceMenuSettings } from "@/lib/workspace/menu-settings-values";

type DropPosition = "before" | "after";
interface DropTarget { key: WorkspaceMenuKey; position: DropPosition }

export function MenuSettingsPanel({ initialSettings }: { initialSettings: ResolvedWorkspaceMenuSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [draggedKey, setDraggedKey] = useState<WorkspaceMenuKey | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  useUnsavedChanges(dirty);

  function update(key: WorkspaceMenuKey, checked: boolean) {
    if (key === "sheet") return;
    setSettings((current) => ({ ...current, [key]: checked }));
    setMessage(null);
  }

  function itemLabel(key: WorkspaceMenuKey): string {
    return WORKSPACE_MENU_OPTIONS.find((item) => item.key === key)?.label ?? key;
  }

  function reorder(dragged: WorkspaceMenuKey, target: WorkspaceMenuKey, position: DropPosition) {
    const order = moveWorkspaceMenu(settings.order, dragged, target, position);
    setSettings((current) => ({ ...current, order }));
    setReorderAnnouncement(`${itemLabel(dragged)} 메뉴를 ${order.indexOf(dragged) + 1}번째로 이동했습니다.`);
    setMessage(null);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, key: WorkspaceMenuKey) {
    if (saving) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-glossary-menu-key", key);
    event.dataTransfer.setData("text/plain", key);
    setDraggedKey(key);
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, key: WorkspaceMenuKey) {
    if (!draggedKey || draggedKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ key, position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, key: WorkspaceMenuKey) {
    event.preventDefault();
    const transferred = event.dataTransfer.getData("application/x-glossary-menu-key") || event.dataTransfer.getData("text/plain");
    const dragged = WORKSPACE_MENU_OPTIONS.some((item) => item.key === transferred) ? transferred as WorkspaceMenuKey : draggedKey;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    if (dragged && dragged !== key) reorder(dragged, key, position);
    setDraggedKey(null);
    setDropTarget(null);
  }

  function moveBy(key: WorkspaceMenuKey, delta: -1 | 1) {
    const index = settings.order.indexOf(key);
    const target = settings.order[index + delta];
    if (!target) return;
    reorder(key, target, delta < 0 ? "before" : "after");
  }

  function handleReorderKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: WorkspaceMenuKey) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveBy(key, event.key === "ArrowUp" ? -1 : 1);
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/menu-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => null) as { settings?: ResolvedWorkspaceMenuSettings; error?: { message?: string } } | null;
      if (!response.ok || !body?.settings) throw new Error(body?.error?.message || `메뉴 설정을 저장하지 못했습니다 (${response.status}).`);
      setSettings(body.settings);
      setSavedSettings(body.settings);
      setMessage({ kind: "ok", text: "메뉴 구성을 저장했습니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "메뉴 설정을 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return <section aria-labelledby="menu-settings-heading">
    <header className="mb-5">
      <h2 id="menu-settings-heading" className="text-base font-semibold text-ink">메뉴 구성</h2>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">용어집의 기본 시트는 항상 표시됩니다. 드래그해서 사이드바 순서를 바꾸고, 나머지 부가 기능은 조직의 사용 범위에 맞춰 숨길 수 있습니다. 숨긴 메뉴는 URL로 직접 접근해도 열리지 않습니다.</p>
    </header>

    <ul className="card overflow-hidden" aria-label="사이드바 메뉴 순서">
      {settings.order.map((key) => {
        const item = WORKSPACE_MENU_OPTIONS.find((option) => option.key === key)!;
        const checked = settings[item.key];
        const disabled = Boolean(item.alwaysOn) || saving;
        const inputId = `workspace-menu-${item.key}`;
        return <li
          key={item.key}
          onDragOver={(event) => handleDragOver(event, item.key)}
          onDragLeave={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            if (dropTarget?.key === item.key) setDropTarget(null);
          }}
          onDrop={(event) => handleDrop(event, item.key)}
          className={cx(
            "relative flex items-center gap-3 border-b border-line p-4 last:border-b-0",
            disabled && item.alwaysOn ? "bg-panel-2/45" : "hover:bg-panel-2/50",
            draggedKey === item.key && "select-none opacity-45",
            dropTarget?.key === item.key && dropTarget.position === "before" && "before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full before:bg-brand",
            dropTarget?.key === item.key && dropTarget.position === "after" && "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand",
          )}
        >
          <button
            type="button"
            draggable={!saving}
            disabled={saving}
            aria-label={`${item.label} 메뉴 순서 변경`}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="드래그하거나 Alt+↑/↓로 순서 변경"
            onDragStart={(event) => handleDragStart(event, item.key)}
            onDragEnd={() => { setDraggedKey(null); setDropTarget(null); }}
            onKeyDown={(event) => handleReorderKeyDown(event, item.key)}
            className="grid h-9 w-9 shrink-0 touch-manipulation cursor-grab place-items-center rounded-md text-base text-ink-3 hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <span role="group" className="flex shrink-0 flex-col gap-0.5" aria-label={`${item.label} 메뉴 위치 조정`}>
            <button
              type="button"
              disabled={saving || settings.order[0] === item.key}
              aria-label={`${item.label} 메뉴 위로 이동`}
              title="위로 이동"
              onClick={() => moveBy(item.key, -1)}
              className="grid h-4 w-6 touch-manipulation place-items-center rounded text-[10px] leading-none text-ink-3 hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <span aria-hidden="true">▲</span>
            </button>
            <button
              type="button"
              disabled={saving || settings.order.at(-1) === item.key}
              aria-label={`${item.label} 메뉴 아래로 이동`}
              title="아래로 이동"
              onClick={() => moveBy(item.key, 1)}
              className="grid h-4 w-6 touch-manipulation place-items-center rounded text-[10px] leading-none text-ink-3 hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <span aria-hidden="true">▼</span>
            </button>
          </span>
          <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {item.label}
              {item.alwaysOn && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">기본</span>}
              {item.adminOnly && <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-medium text-ink-3">관리자 전용</span>}
            </span>
            <span className="mt-1 block text-xs leading-5 text-ink-3">{item.description}</span>
          </label>
          <input id={inputId} name={item.key} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => update(item.key, event.target.checked)} className="h-5 w-5 shrink-0 accent-brand" aria-label={`${item.label} 메뉴 표시`} />
        </li>;
      })}
    </ul>
    <p className="sr-only" aria-live="polite">{reorderAnnouncement}</p>

    {message && <p className={cx("mt-4", message.kind === "bad" ? "note-danger" : "note-ok")} role={message.kind === "bad" ? "alert" : "status"}>{message.text}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      <span className="mr-auto text-xs text-ink-3">{dirty ? "저장하지 않은 변경사항" : "저장된 메뉴 구성과 같습니다"}</span>
      <button type="button" className="btn-primary btn-sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "저장 중…" : "메뉴 구성 저장"}</button>
    </div>
  </section>;
}
