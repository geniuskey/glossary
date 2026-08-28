"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });

    if (res.ok) {
      router.push("/terms");
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "로그인에 실패했습니다.");
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-6">
      <h1 className="mb-6 text-xl font-semibold">로그인</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input name="email" type="email" required placeholder="이메일"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <input name="password" type="password" required placeholder="비밀번호"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded bg-slate-900 px-3 py-2 text-white">
          로그인
        </button>
      </form>
    </main>
  );
}
