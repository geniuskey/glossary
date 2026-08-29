"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { performRevert } from "@/lib/terms/revert-request";

// R95(보안 불변식): 되돌리기는 쓰기다. `<Link href="/api/...">`나 form action으로
// 만들면 GET 한 번으로 남의 용어를 되돌릴 수 있게 되어 SameSite=Lax 쿠키뿐인
// 이 사이트의 CSRF 방어가 뚫린다 — LogoutButton과 같은 이유로 fetch POST를 쓴다.
export function RevertButton({
  slug,
  revisionNumber,
  expectedRevision,
}: {
  slug: string;
  revisionNumber: number;
  expectedRevision: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const outcome = await performRevert(fetch, slug, revisionNumber, expectedRevision);
    if (!outcome.ok) {
      setError(outcome.message ?? "되돌리지 못했습니다.");
      setBusy(false);
      return;
    }
    // 새 리비전이 하나 더 생겼으므로 목록을 다시 읽는다. busy는 풀지 않는다 —
    // refresh가 끝나면 이 컴포넌트 자체가 새 props로 다시 그려진다.
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={busy} className="btn-ghost btn-sm">
        {busy ? "되돌리는 중" : "이 버전으로 되돌리기"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
