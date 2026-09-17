"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MissingFields } from "@/components/term-completion";
import type { ContributionTerm } from "@/lib/terms/query";
import { cx, displayName, relativeTime } from "@/lib/ui/format";
import { ManualReviewButton } from "./manual-review-button";

type QueueStatus = "queued" | "processing" | "ready" | "failed";
type Message = { kind: "ok" | "bad"; text: string } | null;

function isActiveStatus(status: QueueStatus | undefined): boolean {
  return status === "queued" || status === "processing";
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status}).`;
}

export function ContributionQueueTable({ initialItems, initialStatuses, aiAvailable }: {
  initialItems: ContributionTerm[];
  initialStatuses: Record<string, QueueStatus | undefined>;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const selectableItems = initialItems.filter((item) => !isActiveStatus(initialStatuses[item.id]));
  const selectedCount = selectableItems.filter((item) => selectedIds.has(item.id)).length;
  const allSelectableSelected = selectableItems.length > 0 && selectedCount === selectableItems.length;
  const someSelectableSelected = selectedCount > 0 && !allSelectableSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelectableSelected;
  }, [someSelectableSelected]);

  useEffect(() => {
    const selectableIds = new Set(selectableItems.map((item) => item.id));
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => selectableIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [initialItems, initialStatuses]);

  function toggleSelected(termId: string): void {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(termId)) next.delete(termId);
      else next.add(termId);
      return next;
    });
  }

  function toggleAll(): void {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allSelectableSelected) selectableItems.forEach((item) => next.delete(item.id));
      else selectableItems.forEach((item) => next.add(item.id));
      return next;
    });
  }

  async function requestBulkReview(): Promise<void> {
    const selectedItems = initialItems.filter((item) => selectedIds.has(item.id) && !isActiveStatus(initialStatuses[item.id]));
    if (!aiAvailable || bulkBusy || selectedItems.length === 0) return;
    if (!window.confirm(`${selectedItems.length}개 용어의 AI 검토를 요청할까요?`)) return;

    setBulkBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/review-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: selectedItems.map((item) => ({ termId: item.id, revision: item.revision })) }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "AI 검토를 요청하지 못했습니다"));
      const body = await response.json() as { queued?: unknown; skipped?: unknown };
      const queued = typeof body.queued === "number" ? body.queued : selectedItems.length;
      const skipped = typeof body.skipped === "number" ? body.skipped : 0;
      setSelectedIds(new Set());
      setMessage({ kind: "ok", text: skipped > 0 ? `${queued}개 요청됨 · ${skipped}개 제외됨` : `${queued}개 요청됨` });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "AI 검토를 요청하지 못했습니다." });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <label className="flex min-h-9 items-center gap-2 text-sm text-ink-2">
          <input
            ref={selectAllRef}
            type="checkbox"
            aria-label={someSelectableSelected ? "현재 페이지 일부 선택됨 · 모두 선택" : "현재 페이지 전체 선택"}
            aria-checked={someSelectableSelected ? "mixed" : allSelectableSelected}
            checked={allSelectableSelected}
            onChange={toggleAll}
            disabled={!aiAvailable || bulkBusy || selectableItems.length === 0}
            className="h-4 w-4 rounded accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
          />
          <span>전체 선택</span>
          {selectedCount > 0 && <span className="text-xs tabular-nums text-ink-3">{selectedCount}개 선택</span>}
        </label>
        <button
          type="button"
          className="btn-quiet btn-sm"
          disabled={!aiAvailable || bulkBusy || selectedCount === 0}
          title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : undefined}
          onClick={() => void requestBulkReview()}
        >
          {bulkBusy ? "요청 중…" : "일괄 AI 검토 요청"}
        </button>
      </div>

      <div className="overflow-hidden">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">정리를 기다리는 용어 목록</caption>
          <thead className="bg-panel-2/55 text-xs text-ink-2">
            <tr>
              <th scope="col" className="w-[32%] border-b border-line px-2 py-3 font-semibold md:w-[26%]">용어</th>
              <th scope="col" className="w-[30%] border-b border-line px-2 py-3 font-semibold md:w-[26%]">필요한 정보</th>
              <th scope="col" className="hidden w-[14%] border-b border-line px-2 py-3 font-semibold lg:table-cell lg:px-4">최근 수정</th>
              <th scope="col" className="w-[38%] border-b border-line px-2 py-3 text-right font-semibold md:w-[48%] lg:w-[34%] lg:px-4">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {initialItems.map((term) => {
              const active = isActiveStatus(initialStatuses[term.id]);
              const selected = selectedIds.has(term.id);
              return (
                <tr key={term.id} className={cx("align-top", selected ? "bg-brand-soft/35" : "hover:bg-panel-2/30")}>
                  <td className="min-w-0 px-2 py-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        aria-label={`${displayName(term)} 선택`}
                        checked={selected}
                        onChange={() => toggleSelected(term.id)}
                        disabled={!aiAvailable || bulkBusy || active}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
                      />
                      <div className="min-w-0">
                        <Link href={`/edit/${term.slug}`} className="break-words font-semibold text-ink hover:text-brand">{displayName(term)}</Link>
                        {(term.fullNameEn || term.fullNameKo) && (
                          <p className="mt-1 line-clamp-2 break-words text-xs text-ink-3">
                            {[term.fullNameEn, term.fullNameKo].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0 px-2 py-3">
                    <div className="min-w-0 break-words [&_.chip]:max-w-full [&_.chip]:whitespace-normal">
                      {term.completion.complete ? (
                        <span className="chip border-ok/30 bg-ok-soft text-ok">기준 충족</span>
                      ) : (
                        <MissingFields completion={term.completion} />
                      )}
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-3 text-xs text-ink-3 lg:table-cell lg:px-4">
                    <time dateTime={term.updatedAt}>{relativeTime(new Date(term.updatedAt))}</time>
                  </td>
                  <td className="min-w-0 px-2 py-3 lg:px-4">
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <ManualReviewButton termId={term.id} revision={term.revision} initialStatus={initialStatuses[term.id]} aiAvailable={aiAvailable} />
                      <Link href={`/edit/${term.slug}`} className="btn-primary btn-sm break-words">
                        {term.status === "draft" && term.completion.complete ? "검토하고 저장" : "내용 채우기"}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && <p role={message.kind === "bad" ? "alert" : "status"} aria-live="polite" className={cx("border-t border-line px-4 py-2.5 text-xs", message.kind === "bad" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{message.text}</p>}
    </div>
  );
}
