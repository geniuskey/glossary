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
      router.push("/terms");
      router.refresh();
      return;
    }
    setPending(false);
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "설정에 실패했습니다.");
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-6">
      <h1 className="mb-1 text-xl font-semibold">관리자 계정 만들기</h1>
      <p className="mb-6 text-sm text-slate-500">
        처음 접속했습니다. 이 용어집을 관리할 첫 관리자 계정을 만듭니다.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input name="email" type="email" required placeholder="이메일"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <input name="name" type="text" placeholder="이름 (생략 시 이메일)"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <input name="password" type="password" required minLength={8} placeholder="비밀번호 (8자 이상)"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <input name="confirm" type="password" required minLength={8} placeholder="비밀번호 확인"
          className="w-full rounded border border-slate-300 px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
          {pending ? "만드는 중..." : "관리자 계정 만들기"}
        </button>
      </form>
    </main>
  );
}
