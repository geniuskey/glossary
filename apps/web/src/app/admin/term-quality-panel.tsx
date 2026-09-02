"use client";

import { useState } from "react";
import { HelpTip } from "@/components/help-tip";
import {
  TERM_QUALITY_LIMITS,
  type TermQualitySettings,
} from "@/lib/workspace/term-quality-values";
import { cx } from "@/lib/ui/format";

export function TermQualityPanel({ initialSettings }: { initialSettings: TermQualitySettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const valid = Object.values(settings).every((value) => Number.isInteger(value)
    && value >= TERM_QUALITY_LIMITS.min
    && value <= TERM_QUALITY_LIMITS.max);

  function update(key: keyof TermQualitySettings, raw: string) {
    setSettings((current) => ({ ...current, [key]: Number(raw) }));
    setMessage(null);
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/term-quality", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => null) as
        | { settings?: TermQualitySettings; error?: { message?: string } }
        | null;
      if (!response.ok || !body?.settings) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setSettings(body.settings);
      setMessage({ kind: "ok", text: "용어 작성 수준을 저장했습니다." });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="term-quality-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="term-quality-heading" className="text-base font-semibold text-ink">용어 작성 수준</h2>
        <HelpTip text="공동 정리 대기열과 완성도 배지가 정의·본문의 실제 글자 수를 이 기준과 비교합니다. 0자는 해당 항목을 검사하지 않습니다." />
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 border-b border-line px-4 py-3">
          <label htmlFor="definition-min-chars" className="text-sm font-medium text-ink">정의 최소 글자 수</label>
          <NumberField id="definition-min-chars" value={settings.definitionMinChars} disabled={saving} onChange={(value) => update("definitionMinChars", value)} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 px-4 py-3">
          <label htmlFor="body-min-chars" className="text-sm font-medium text-ink">본문 최소 글자 수</label>
          <NumberField id="body-min-chars" value={settings.bodyMinChars} disabled={saving} onChange={(value) => update("bodyMinChars", value)} />
        </div>
        <div className="flex min-h-12 items-center justify-end gap-2 border-t border-line bg-panel-2/50 px-4 py-2.5">
          {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mr-auto text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
          <button type="button" className="btn-primary btn-sm" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? "저장 중…" : "작성 수준 저장"}
          </button>
        </div>
      </div>
    </section>
  );
}

function NumberField({ id, value, disabled, onChange }: { id: string; value: number; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <span className="relative block">
      <input
        id={id}
        type="number"
        min={TERM_QUALITY_LIMITS.min}
        max={TERM_QUALITY_LIMITS.max}
        step={1}
        required
        value={Number.isNaN(value) ? "" : value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="field h-9 py-0 pr-8 text-right font-mono tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-ink-3">자</span>
    </span>
  );
}
