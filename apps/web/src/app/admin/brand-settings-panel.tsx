"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceBrandPreset } from "@glossary/db";
import { DEFAULT_WORKSPACE_MENU_SETTINGS, WORKSPACE_BRAND_OPTIONS } from "@/lib/workspace/menu-settings-values";
import { cx } from "@/lib/ui/format";
import { useUnsavedChanges } from "@/lib/ui/use-unsaved-changes";

function applyBrand(preset: WorkspaceBrandPreset) {
  if (preset === DEFAULT_WORKSPACE_MENU_SETTINGS.brandPreset) document.documentElement.removeAttribute("data-brand");
  else document.documentElement.setAttribute("data-brand", preset);
}

export function BrandSettingsPanel({ initialPreset }: { initialPreset: WorkspaceBrandPreset }) {
  const router = useRouter();
  const [preset, setPreset] = useState(initialPreset);
  const [savedPreset, setSavedPreset] = useState(initialPreset);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const dirty = preset !== savedPreset;
  useUnsavedChanges(dirty);

  // 고르는 즉시 이 화면 전체가 미리보기가 된다. 저장하지 않고 떠나면 정리 함수가
  // 저장된 색으로 되돌린다 — 그대로 두면 다른 화면까지 고르다 만 색으로 보인다.
  useEffect(() => {
    applyBrand(preset);
    return () => applyBrand(savedPreset);
  }, [preset, savedPreset]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/brand", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      const body = await response.json().catch(() => null) as { preset?: WorkspaceBrandPreset; error?: { message?: string } } | null;
      if (!response.ok || !body?.preset) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setPreset(body.preset);
      setSavedPreset(body.preset);
      setMessage({ kind: "ok", text: "대표 색을 저장했습니다. 모든 사용자에게 적용됩니다." });
      router.refresh();
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="brand-settings-heading">
      <div className="mb-3">
        <h2 id="brand-settings-heading" className="text-base font-semibold text-ink text-balance">대표 색</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          이 용어집 전체에 적용되는 브랜드 색입니다. 고르면 이 화면에 바로 미리 적용되고, 저장하면 모든 사용자에게 같은 색이 보입니다.
          상태를 뜻하는 색(완료·경고·오류)과 겹치지 않는 조합만 제공합니다.
        </p>
      </div>

      <div className="card p-4 sm:p-5">
        <fieldset>
          <legend className="sr-only">대표 색 프리셋</legend>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {WORKSPACE_BRAND_OPTIONS.map((option) => {
              const selected = option.key === preset;
              const { surface, logo, brand, accent } = option.swatches;
              return (
                <label
                  key={option.key}
                  className={cx(
                    "flex cursor-pointer flex-col overflow-hidden rounded-xl border transition",
                    selected ? "border-brand ring-2 ring-brand/25" : "border-line hover:border-line-strong",
                    saving && "cursor-not-allowed opacity-55",
                  )}
                >
                  <span aria-hidden className="flex h-20 bg-paper">
                    <span className={cx("flex w-12 flex-col gap-1.5 p-2", option.lightSurface && "border-r border-line")} style={{ backgroundColor: surface }}>
                      <span className="h-4 w-4 rounded" style={{ backgroundColor: logo }} />
                      <span className={cx("mt-1 h-1 w-6 rounded-full", option.lightSurface ? "bg-ink/25" : "bg-white/60")} />
                      <span className={cx("h-1 w-5 rounded-full", option.lightSurface ? "bg-ink/15" : "bg-white/35")} />
                      <span className="h-1 w-6 rounded-full" style={{ backgroundColor: accent }} />
                    </span>
                    <span className="flex flex-1 flex-col justify-center gap-2 px-3">
                      <span className="h-1.5 w-16 rounded-full bg-line-strong" />
                      <span className="flex items-center gap-2">
                        <span className="h-5 w-14 rounded-md" style={{ backgroundColor: brand }} />
                        <span className="h-1.5 w-8 rounded-full" style={{ backgroundColor: accent }} />
                      </span>
                    </span>
                  </span>
                  <span className="flex gap-2.5 border-t border-line bg-panel p-3">
                    <input
                      type="radio"
                      name="brand-preset"
                      value={option.key}
                      checked={selected}
                      disabled={saving}
                      onChange={() => {
                        setPreset(option.key);
                        setMessage(null);
                      }}
                      className="mt-0.5 h-4 w-4 accent-brand"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {option.label}
                        {option.key === savedPreset && <span className="ml-1.5 text-[11px] font-normal text-ink-3">현재</span>}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ink-3">{option.description}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {message && (
          <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mt-4", message.kind === "bad" ? "note-danger" : "note-ok")}>
            {message.text}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <span className="mr-auto text-xs text-ink-3" role="status">{dirty ? "미리보기 중 — 저장하지 않은 변경사항" : "저장된 색과 같습니다"}</span>
          <button type="button" disabled={saving || !dirty} onClick={() => setPreset(savedPreset)} className="btn-quiet btn-sm">
            되돌리기
          </button>
          <button type="button" disabled={saving || !dirty} onClick={() => void save()} className="btn-primary btn-sm">
            {saving ? "저장 중…" : "대표 색 저장"}
          </button>
        </div>
      </div>
    </section>
  );
}
