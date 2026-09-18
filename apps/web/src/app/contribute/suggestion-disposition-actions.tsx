"use client";

import { useState } from "react";
import type { AiSuggestionDisposition, AiSuggestionFeature, SuggestionSnapshot } from "@/lib/ai/suggestion-dispositions";

const LABELS: Record<AiSuggestionDisposition, string> = {
  dismissed: "오탐으로 숨김",
  deferred: "보류",
  saved: "내 작업에 저장",
};

const REASONS: Record<AiSuggestionDisposition, string> = {
  dismissed: "사용자 판단: 오탐으로 숨김",
  deferred: "사용자 판단: 추가 확인 필요",
  saved: "사용자 판단: 나중에 처리",
};

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `처리하지 못했습니다 (${response.status})`;
}

export function SuggestionDispositionActions({
  termId,
  revision,
  feature,
  suggestionId,
  generatorVersion,
  payload,
  disabled = false,
  onApplied,
}: {
  termId: string;
  revision: number;
  feature: AiSuggestionFeature;
  suggestionId: string;
  generatorVersion: number;
  payload: SuggestionSnapshot;
  disabled?: boolean;
  onApplied?: (disposition: AiSuggestionDisposition) => void;
}) {
  const [busy, setBusy] = useState<AiSuggestionDisposition | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(disposition: AiSuggestionDisposition): Promise<void> {
    if (busy) return;
    setBusy(disposition);
    setError(null);
    try {
      const response = await fetch("/api/v1/contributions/suggestion-dispositions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId, revision, feature, suggestionId, generatorVersion, disposition, reason: REASONS[disposition], payload }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      onApplied?.(disposition);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "제안 상태를 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
      {(Object.keys(LABELS) as AiSuggestionDisposition[]).map((disposition) => (
        <button
          key={disposition}
          type="button"
          className="btn-quiet btn-sm !px-2 !py-1 text-[11px]"
          disabled={disabled || busy !== null}
          onClick={() => void apply(disposition)}
        >
          {busy === disposition ? "처리 중…" : LABELS[disposition]}
        </button>
      ))}
      {error && <span role="alert" className="w-full text-right text-[11px] text-danger">{error}</span>}
    </div>
  );
}
