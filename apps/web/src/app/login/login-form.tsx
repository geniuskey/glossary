"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    let res: Response;
    try {
      res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
    } catch {
      setPending(false);
      setError("네트워크 오류로 로그인하지 못했습니다.");
      return;
    }

    if (res.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    setPending(false);
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "로그인에 실패했습니다.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div>
        <label htmlFor="login-email" className="label">
          이메일
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          spellCheck={false}
          placeholder="name@example.com…"
          className="field"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="label">
          비밀번호
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          maxLength={1024}
          autoComplete="current-password"
          className="field"
        />
      </div>

      {/* 실패 사유는 서버가 고른 문구 그대로 보여준다(계정 존재 여부를 흘리지 않는다). */}
      {error && (
        <p role="alert" className="note-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}
