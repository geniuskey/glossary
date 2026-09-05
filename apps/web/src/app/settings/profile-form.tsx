"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProfileForm({
  initialName,
  canRefreshSso,
  initialSsoMessage,
}: {
  initialName: string;
  canRefreshSso: boolean;
  initialSsoMessage?: { ok: boolean; text: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshingSso, setRefreshingSso] = useState(false);
  const [ssoMessage, setSsoMessage] = useState(initialSsoMessage ?? null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || saving || nextName === savedName) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `이름을 저장하지 못했습니다 (${response.status}).`);
      setName(nextName);
      setSavedName(nextName);
      setMessage({ ok: true, text: "이름을 변경했습니다." });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function refreshSso() {
    if (refreshingSso) return;
    setRefreshingSso(true);
    setSsoMessage(null);
    try {
      const response = await fetch("/api/v1/account/sso-refresh", { method: "POST" });
      const body = await response.json().catch(() => null) as {
        user?: { name?: string };
        redirectTo?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? `SSO 정보를 가져오지 못했습니다 (${response.status}).`);
      }
      if (body?.redirectTo === "/auth/sso/start?refresh=1") {
        window.location.assign(body.redirectTo);
        return;
      }
      if (typeof body?.user?.name === "string" && body.user.name) {
        setName(body.user.name);
        setSavedName(body.user.name);
      }
      setSsoMessage({ ok: true, text: "SSO 정보를 다시 가져왔습니다." });
      router.refresh();
    } catch (error) {
      setSsoMessage({
        ok: false,
        text: error instanceof Error ? error.message : "SSO 정보를 가져오지 못했습니다.",
      });
    } finally {
      setRefreshingSso(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 border-t border-line pt-4">
      <label htmlFor="profile-name" className="label">표시 이름</label>
      <div className="flex gap-2">
        <input
          id="profile-name"
          value={name}
          onChange={(event) => { setName(event.target.value); setMessage(null); }}
          required
          maxLength={100}
          autoComplete="name"
          className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={saving || !name.trim() || name.trim() === savedName} className="btn-primary shrink-0">
          {saving ? "저장 중…" : "변경"}
        </button>
      </div>
      {message && <p className={message.ok ? "mt-2 text-xs text-ok" : "note-danger mt-2"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {canRefreshSso && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">SSO 정보</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-3">
                회사 계정의 이름·이메일·그룹을 다시 읽습니다. 현재 표시 이름도 SSO 값으로 덮어씁니다.
              </p>
            </div>
            <button type="button" onClick={refreshSso} disabled={refreshingSso} className="btn-ghost shrink-0 self-start sm:self-auto">
              {refreshingSso ? "가져오는 중…" : "SSO 정보 다시 가져오기"}
            </button>
          </div>
          {ssoMessage && (
            <p className={ssoMessage.ok ? "mt-2 text-xs text-ok" : "note-danger mt-2"} role={ssoMessage.ok ? "status" : "alert"}>
              {ssoMessage.text}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
