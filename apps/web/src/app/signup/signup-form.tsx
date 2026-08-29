"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// setup-form.tsx와 같은 형태다(같은 필드, 같은 검증). 두 화면을 한 컴포넌트로
// 합치지 않는 이유는 보내는 곳과 실패 문구가 다르고, 최초 설정 화면은 "한 번만
// 하는 일"이라는 안내를 함께 지고 있기 때문이다.
export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    // 서버도 8자를 요구하지만(register/route.ts), 여기서 먼저 막으면 왕복 없이
    // 즉시 알려줄 수 있다. 비밀번호 확인은 서버가 알 수 없는 검증이다.
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setPending(true);
    const res = await fetch("/api/v1/auth/register", {
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
    setError(body?.error?.message ?? "가입에 실패했습니다.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <div>
        <label htmlFor="signup-email" className="label">
          이메일
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
          className="field"
        />
      </div>

      {/* 이름은 선택이지만, 이력 화면에 "누가 고쳤는지"로 그대로 나가는 값이다.
          비우면 이메일이 대신 나간다는 사실을 라벨 줄에서 미리 말한다. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="signup-name" className="label mb-0">
            이름
          </label>
          <span className="text-[11px] text-ink-3">선택 · 수정 이력에 표시됩니다</span>
        </div>
        <input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="표시할 이름"
          className="field"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="signup-password" className="label mb-0">
            비밀번호
          </label>
          <span className="text-[11px] text-ink-3">8자 이상</span>
        </div>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field"
        />
      </div>

      <div>
        <label htmlFor="signup-confirm" className="label">
          비밀번호 확인
        </label>
        <input
          id="signup-confirm"
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
        {pending ? "만드는 중..." : "계정 만들기"}
      </button>
    </form>
  );
}
