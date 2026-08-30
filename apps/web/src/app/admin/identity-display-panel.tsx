"use client";

import { useState } from "react";
import { cx } from "@/lib/ui/format";
import {
  IDENTITY_DISPLAY_LIMITS,
  type IdentityDisplaySettings,
  userDisplayLabel,
} from "@/lib/workspace/identity-display-values";

export function IdentityDisplayPanel({ initialSettings }: { initialSettings: IdentityDisplaySettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const paired = Boolean(settings.emailDomain.trim()) === Boolean(settings.organization.trim());

  function set(key: keyof IdentityDisplaySettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save() {
    if (saving || !paired) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/identity-display", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => null) as { settings?: IdentityDisplaySettings; error?: { message?: string } } | null;
      if (!response.ok || !body?.settings) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `저장하지 못했습니다 (${response.status}).` });
        return;
      }
      setSettings(body.settings);
      setMessage({ kind: "ok", text: "담당자 표시 설정을 저장했습니다." });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  const previewEmail = settings.emailDomain.trim() ? `minji@${settings.emailDomain.trim()}` : "minji@company.com";
  return (
    <section aria-labelledby="identity-display-heading">
      <div className="mb-3">
        <h2 id="identity-display-heading" className="text-base font-semibold text-ink text-balance">담당자 표시</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">회사 이메일 전체를 노출하지 않고 같은 도메인의 구성원을 조직명으로 표시합니다.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <label className="block">
            <span className="label">회사 이메일 도메인</span>
            <input value={settings.emailDomain} maxLength={IDENTITY_DISPLAY_LIMITS.domain} disabled={saving} onChange={(e) => set("emailDomain", e.target.value)} placeholder="company.com" className="field" />
            <span className="mt-1.5 block text-xs text-ink-3">@ 없이 입력합니다. 대소문자는 구분하지 않습니다.</span>
          </label>
          <label className="block">
            <span className="label">표시할 조직명</span>
            <input value={settings.organization} maxLength={IDENTITY_DISPLAY_LIMITS.organization} disabled={saving} onChange={(e) => set("organization", e.target.value)} placeholder="Platform 조직" className="field" />
            <span className="mt-1.5 block text-xs text-ink-3">담당자 이름 뒤에 표시할 팀·본부명입니다.</span>
          </label>
          {!paired && <p role="alert" className="note-danger sm:col-span-2">이메일 도메인과 조직명을 함께 입력하거나 둘 다 비워 주세요.</p>}
          {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx(message.kind === "bad" ? "note-danger" : "note-ok", "sm:col-span-2")}>{message.text}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2">
            <button type="button" className="btn-quiet btn-sm" disabled={saving} onClick={() => setSettings({ emailDomain: "", organization: "" })}>이메일 표시로 되돌리기</button>
            <button type="button" className="btn-primary btn-sm" disabled={saving || !paired} onClick={() => void save()}>{saving ? "저장 중…" : "표시 설정 저장"}</button>
          </div>
        </div>
        <div className="card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">미리보기</p>
          <p className="mt-5 text-sm font-medium text-ink">{userDisplayLabel({ name: "김민지", email: previewEmail }, settings)}</p>
          <p className="mt-2 text-xs leading-5 text-ink-3">도메인이 다른 외부 계정은 `이름 · 이메일`로 표시됩니다.</p>
        </div>
      </div>
    </section>
  );
}
