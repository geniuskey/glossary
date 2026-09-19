"use client";

import { useState } from "react";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";
import { WORKSPACE_MENU_OPTIONS } from "@/lib/workspace/menu-settings-values";
import type { ResolvedWorkspaceMenuSettings } from "@/lib/workspace/menu-settings-values";

export function MenuSettingsPanel({ initialSettings }: { initialSettings: ResolvedWorkspaceMenuSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  useUnsavedChanges(dirty);

  function update(key: keyof ResolvedWorkspaceMenuSettings, checked: boolean) {
    if (key === "sheet") return;
    setSettings((current) => ({ ...current, [key]: checked }));
    setMessage(null);
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
      <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">용어집의 기본 시트는 항상 표시됩니다. 나머지 부가 기능은 조직의 사용 범위에 맞춰 사이드바에서 숨길 수 있습니다. 숨긴 메뉴는 URL로 직접 접근해도 열리지 않습니다.</p>
    </header>

    <div className="card divide-y divide-line overflow-hidden">
      {WORKSPACE_MENU_OPTIONS.map((item) => {
        const checked = settings[item.key];
        const disabled = Boolean(item.alwaysOn) || saving;
        return <label key={item.key} className={cx("flex items-center gap-4 p-4", disabled && item.alwaysOn ? "bg-panel-2/45" : "hover:bg-panel-2/50")}>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {item.label}
              {item.alwaysOn && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">기본</span>}
              {item.adminOnly && <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-medium text-ink-3">관리자 전용</span>}
            </span>
            <span className="mt-1 block text-xs leading-5 text-ink-3">{item.description}</span>
          </span>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => update(item.key, event.target.checked)} className="h-5 w-5 shrink-0 accent-brand" aria-label={`${item.label} 메뉴 표시`} />
        </label>;
      })}
    </div>

    {message && <p className={cx("mt-4", message.kind === "bad" ? "note-danger" : "note-ok")} role={message.kind === "bad" ? "alert" : "status"}>{message.text}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      <span className="mr-auto text-xs text-ink-3">{dirty ? "저장하지 않은 변경사항" : "저장된 메뉴 구성과 같습니다"}</span>
      <button type="button" className="btn-primary btn-sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "저장 중…" : "메뉴 구성 저장"}</button>
    </div>
  </section>;
}
