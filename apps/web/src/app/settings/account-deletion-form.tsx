"use client";

import { useState } from "react";

export function AccountDeletionForm({ email, requiresPassword }: { email: string; requiresPassword: boolean }) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailMatches = confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();

  async function removeAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !emailMatches || (requiresPassword && !password)) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail, ...(requiresPassword ? { password } : {}) }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `탈퇴 요청을 처리하지 못했습니다 (${response.status}).`);
      window.location.assign("/login?withdrawn=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "탈퇴 요청을 처리하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <section className="card mt-4 border border-danger/35 p-5" aria-labelledby="delete-account-heading">
      <p className="text-xs font-semibold text-danger">계정 관리</p>
      <h2 id="delete-account-heading" className="mt-1 font-semibold text-ink text-balance">계정 탈퇴</h2>
      <p className="mt-2 text-sm leading-6 text-ink-2">
        계정, 로그인 세션, API 키와 개인 대화 기록이 삭제됩니다. 용어와 수정 이력은 사전 보존을 위해 남고 작성자 연결은 제거됩니다.
        다시 가입하면 새 계정으로 시작합니다.
      </p>

      <form onSubmit={removeAccount} className="mt-4 max-w-lg space-y-3 border-t border-line pt-4">
        <div>
          <label htmlFor="delete-account-email" className="label">확인을 위해 계정 이메일을 입력해 주세요</label>
          <input
            id="delete-account-email"
            type="email"
            value={confirmEmail}
            onChange={(event) => { setConfirmEmail(event.target.value); setError(null); }}
            autoComplete="email"
            required
            maxLength={254}
            className="field"
          />
        </div>
        {requiresPassword && (
          <div>
            <label htmlFor="delete-account-password" className="label">현재 비밀번호</label>
            <input
              id="delete-account-password"
              type="password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(null); }}
              autoComplete="current-password"
              required
              maxLength={1024}
              className="field"
            />
          </div>
        )}
        {error && <p className="note-danger" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={pending || !emailMatches || (requiresPassword && !password)}
          className="btn-quiet border border-danger/35 text-danger hover:bg-danger-soft"
        >
          {pending ? "탈퇴 처리 중…" : "계정 탈퇴"}
        </button>
      </form>
    </section>
  );
}
