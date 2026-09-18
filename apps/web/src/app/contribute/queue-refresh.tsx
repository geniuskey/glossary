"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** One refresh timer per page, rather than one request per term card. */
export function QueueRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return active ? <p role="status" className="mb-3 text-xs text-ink-3">진행 중인 AI 작업이 있어 현황을 5초마다 갱신합니다.</p> : null;
}
