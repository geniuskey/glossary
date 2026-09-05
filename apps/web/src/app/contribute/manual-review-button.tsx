"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReviewQueueStatus } from "@/lib/ai/auto-review";

const LABEL: Record<ReviewQueueStatus, string> = {
  queued: "AI 검토 대기 중",
  processing: "AI 검토 중",
  ready: "AI 재검토",
  failed: "AI 검토 다시 요청",
};

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `AI 검토를 요청하지 못했습니다. (${response.status})`;
}

export function ManualReviewButton({ termId, revision, initialStatus, aiAvailable }: {
  termId: string;
  revision: number;
  initialStatus?: ReviewQueueStatus;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ReviewQueueStatus | undefined>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStatus(initialStatus), [initialStatus]);

  async function requestReview() {
    if (busy || !aiAvailable || status === "queued" || status === "processing") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/contributions/review-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId, revision }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setStatus("queued");
      window.setTimeout(() => router.refresh(), 1_500);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI 검토를 요청하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !aiAvailable || status === "queued" || status === "processing";
  const label = busy ? "요청 중…" : status ? LABEL[status] : "AI 검토 요청";

  return <div className="flex flex-col items-end gap-1">
    <button
      type="button"
      className="btn-quiet btn-sm"
      disabled={disabled}
      title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : undefined}
      onClick={() => void requestReview()}
    >
      {label}
    </button>
    {error && <span className="max-w-52 text-right text-[11px] leading-4 text-danger" role="alert">{error}</span>}
  </div>;
}
