"use client";

import { useEffect, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import type { TermQualityOverview } from "@/lib/workspace/term-quality";
import {
  TERM_QUALITY_LIMITS,
  TERM_QUALITY_PROFILE_DESCRIPTION,
  TERM_QUALITY_PROFILE_LABEL,
  type ResolvedTermQualityProfile,
  type TermQualitySettings,
} from "@/lib/workspace/term-quality-values";
import { cx } from "@/lib/ui/format";

const PROFILES: ResolvedTermQualityProfile[] = ["mapping", "context", "guidance"];

export function TermQualityPanel({
  initialSettings,
  initialOverview,
}: {
  initialSettings: TermQualitySettings;
  initialOverview: TermQualityOverview;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [overview, setOverview] = useState(initialOverview);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const values = Object.values(settings);
  const valid = values.every((value) => Number.isInteger(value)
    && value >= TERM_QUALITY_LIMITS.min
    && value <= TERM_QUALITY_LIMITS.max);
  const changed = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const response = await fetch("/api/v1/admin/term-quality", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as { overview?: TermQualityOverview } | null;
        if (response.ok && body?.overview) setOverview(body.overview);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage({ kind: "bad", text: "영향을 계산하지 못했습니다." });
        }
      } finally {
        if (!controller.signal.aborted) setPreviewing(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [settings, valid]);

  function update(key: keyof TermQualitySettings, raw: string) {
    setSettings((current) => ({ ...current, [key]: raw === "" ? Number.NaN : Number(raw) }));
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
        | { settings?: TermQualitySettings; overview?: TermQualityOverview; error?: { message?: string } }
        | null;
      if (!response.ok || !body?.settings || !body.overview) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setSettings(body.settings);
      setSavedSettings(body.settings);
      setOverview(body.overview);
      setMessage({ kind: "ok", text: "AI 활용 기준을 저장했습니다." });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="term-quality-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="term-quality-heading" className="text-base font-semibold text-ink">AI 활용 기준</h2>
        <HelpTip text="자동 기준은 Full name이 있는 약어·식별자·단위를 표기 매핑으로 보고, 나머지는 맥락 설명으로 봅니다. 폐기·금지 용어는 사용 지침을 적용하며 용어별로 바꿀 수 있습니다." />
        <p className="ml-auto text-xs tabular-nums text-ink-3" aria-live="polite">
          {previewing ? "영향 계산 중…" : `${overview.complete}/${overview.total}개 충족 · ${overview.incomplete}개 보완 필요`}
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="border-b border-line bg-panel-2/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">기준</th>
                <th scope="col" className="px-4 py-2.5 font-medium">충족 조건</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">현재 결과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PROFILES.map((profile) => (
                <tr key={profile}>
                  <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-ink">{TERM_QUALITY_PROFILE_LABEL[profile]}</th>
                  <td className="px-4 py-3 text-xs leading-5 text-ink-2">{TERM_QUALITY_PROFILE_DESCRIPTION[profile]}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-ink-2">
                    {overview.profiles[profile].complete}/{overview.profiles[profile].total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="border-t border-line">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-ink-2 hover:bg-panel-2/50">
            글자 수 보조 기준
          </summary>
          <div className="grid gap-3 border-t border-line bg-panel-2/30 px-4 py-3 sm:grid-cols-2">
            <NumberField id="definition-min-chars" name="definitionMinChars" label="한줄 정의 최소 글자 수" value={settings.definitionMinChars} disabled={saving} onChange={(value) => update("definitionMinChars", value)} />
            <NumberField id="body-min-chars" name="bodyMinChars" label="본문 최소 글자 수" value={settings.bodyMinChars} disabled={saving} onChange={(value) => update("bodyMinChars", value)} />
            <p className="text-[11px] leading-5 text-ink-3 sm:col-span-2">0자는 내용 존재 여부만 검사합니다. 1자 이상이면 프로필의 구조적 조건에 최소 길이를 추가하며 Full name을 별도로 제한하지 않습니다.</p>
          </div>
        </details>

        <div className="flex min-h-12 items-center justify-end gap-2 border-t border-line bg-panel-2/50 px-4 py-2.5">
          {!valid && <p role="alert" className="mr-auto text-xs text-danger">0부터 10,000 사이의 정수를 입력해 주세요.</p>}
          {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mr-auto text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
          <button type="button" className="btn-primary btn-sm" disabled={!valid || saving || !changed} onClick={() => void save()}>
            {saving ? "저장 중…" : "AI 활용 기준 저장"}
          </button>
        </div>
      </div>
    </section>
  );
}

function NumberField({ id, name, label, value, disabled, onChange }: { id: string; name: string; label: string; value: number; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 text-xs font-medium text-ink">
      {label}
      <span className="relative block">
        <input
          id={id}
          name={name}
          type="number"
          autoComplete="off"
          min={TERM_QUALITY_LIMITS.min}
          max={TERM_QUALITY_LIMITS.max}
          step={1}
          required
          value={Number.isNaN(value) ? "" : value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="field h-9 py-0 pr-8 text-right font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-normal text-ink-3">자</span>
      </span>
    </label>
  );
}
