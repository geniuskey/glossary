"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setPending(true);
    const res = await fetch("/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password,
        name: form.get("name") || undefined,
      }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    setPending(false);
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "설정에 실패했습니다.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div>
        <label htmlFor="setup-email" className="label">
          이메일
        </label>
        <input
          id="setup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
          className="field"
        />
      </div>

      {/* 선택 입력이라는 사실과 비웠을 때 무엇이 보이는지를 라벨 줄에서 함께 말한다 —
          placeholder에만 적어두면 입력을 시작한 순간 사라진다. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="setup-name" className="label mb-0">
            이름
          </label>
          <span className="text-[11px] text-ink-3">선택 · 비우면 이메일이 표시됩니다</span>
        </div>
        <input
          id="setup-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="표시할 이름"
          className="field"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="setup-password" className="label mb-0">
            비밀번호
          </label>
          <span className="text-[11px] text-ink-3">8자 이상</span>
        </div>
        <input
          id="setup-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field"
        />
      </div>

      <div>
        <label htmlFor="setup-confirm" className="label">
          비밀번호 확인
        </label>
        <input
          id="setup-confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field"
        />
      </div>

      {error && (
        <p role="alert" className="note-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "만드는 중..." : "관리자 계정 만들기"}
      </button>
    </form>
  );
}
