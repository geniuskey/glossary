"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReviewQueueItem, ReviewQueueSnapshot, ReviewQueueStatus } from "@/lib/ai/auto-review";
import { REVIEW_QUEUE_FILTER_LABEL, type ReviewQueueFilter } from "@/lib/ai/review-queue-types";
import { cx, relativeTime } from "@/lib/ui/format";

const STATUS: Record<ReviewQueueStatus, { label: string; className: string }> = {
  queued: { label: "대기", className: "bg-warn-soft text-warn" },
  processing: { label: "처리 중", className: "bg-brand-soft text-brand" },
  ready: { label: "검토 필요", className: "bg-ok-soft text-ok" },
  failed: { label: "실패", className: "bg-danger-soft text-danger" },
};

const FILTERS: ReviewQueueFilter[] = ["all", "attention", "active", "ready", "failed"];

function queueHref(filter: ReviewQueueFilter, page = 1): string {
  const params = new URLSearchParams({ tab: "queue" });
  if (filter !== "all") params.set("status", filter);
  if (page > 1) params.set("page", String(page));
  return `/contribute?${params.toString()}`;
}

function filterCount(queue: ReviewQueueSnapshot, filter: ReviewQueueFilter): number {
  if (filter === "attention") return queue.counts.attention;
  if (filter === "active") return queue.counts.active;
  if (filter === "ready") return queue.counts.ready;
  if (filter === "failed") return queue.counts.failed;
  return queue.counts.total;
}

function absoluteTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function timingLabel(item: ReviewQueueItem): string {
  if (item.status === "processing" && item.startedAt) return `처리 시작 ${relativeTime(new Date(item.startedAt))}`;
  if ((item.status === "ready" || item.status === "failed") && item.finishedAt) return `처리 완료 ${relativeTime(new Date(item.finishedAt))}`;
  return `요청 ${relativeTime(new Date(item.requestedAt))}`;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status}).`;
}

export function ReviewQueuePanel({ queue, aiAvailable }: { queue: ReviewQueueSnapshot; aiAvailable: boolean }) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const totalPages = Math.max(1, Math.ceil(queue.filteredTotal / queue.pageSize));
  const metrics = [
    ["검토 필요", queue.counts.ready],
    ["실패", queue.counts.failed],
    ["처리 중", queue.counts.processing],
    ["대기", queue.counts.queued],
    ["전체 작업", queue.counts.total],
  ] as const;

  async function resume(): Promise<void> {
    if (!aiAvailable || busyAction) return;
    setBusyAction("resume");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/review-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "AI 작업을 재개하지 못했습니다"));
      setMessage({ kind: "ok", text: "AI 작업을 다시 시작했습니다. 잠시 후 상태가 갱신됩니다." });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "AI 작업을 재개하지 못했습니다." });
    } finally {
      setBusyAction(null);
    }
  }

  async function retry(item: ReviewQueueItem): Promise<void> {
    if (!aiAvailable || busyAction) return;
    setBusyAction(item.termId);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/review-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: item.termId, revision: item.revision }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "AI 검토를 다시 요청하지 못했습니다"));
      setMessage({ kind: "ok", text: `${item.termName}의 AI 검토를 다시 요청했습니다.` });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "AI 검토를 다시 요청하지 못했습니다." });
    } finally {
      setBusyAction(null);
    }
  }

  return <section aria-label="AI 작업 현황" className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {metrics.map(([label, value], index) => <div key={label} className={cx("card px-3 py-3", index === 0 && "border-brand/30 bg-brand-soft/25")}>
        <p className="text-[11px] font-medium text-ink-3">{label}</p>
        <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value.toLocaleString("ko-KR")}</p>
      </div>)}
    </div>

    <nav aria-label="AI 작업 상태 필터" className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => <Link
        key={filter}
        href={queueHref(filter)}
        aria-current={queue.filter === filter ? "page" : undefined}
        className={cx(
          "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition hover:border-brand/40 hover:text-brand",
          queue.filter === filter ? "border-brand/40 bg-brand-soft/50 text-brand" : "border-line bg-panel text-ink-2",
        )}
      >
        <span>{REVIEW_QUEUE_FILTER_LABEL[filter]}</span>
        <span className="font-mono tabular-nums">{filterCount(queue, filter).toLocaleString("ko-KR")}</span>
      </Link>)}
    </nav>

    {!aiAvailable && <p role="status" aria-live="polite" className="rounded-lg border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-xs text-ink-2">
      AI 연결이 꺼져 있어 새 작업을 시작하거나 실패한 작업을 다시 요청할 수 없습니다. 기존 제안은 계속 검토할 수 있습니다.
    </p>}

    <div className="card overflow-hidden">
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">AI 작업 목록</h2>
          <p className="mt-0.5 text-xs text-ink-3">{REVIEW_QUEUE_FILTER_LABEL[queue.filter]} · {queue.filteredTotal.toLocaleString("ko-KR")}개</p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {queue.counts.active > 0 && <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!aiAvailable || busyAction !== null}
            title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : undefined}
            onClick={() => void resume()}
          >
            {busyAction === "resume" ? "재개 요청 중…" : "처리 재개"}
          </button>}
          <Link href={queueHref(queue.filter, queue.page)} className="btn-quiet btn-sm">새로고침</Link>
        </div>
      </header>

      {queue.items.length > 0 ? <ul className="divide-y divide-line">
        {queue.items.map((item) => {
          const status = STATUS[item.status];
          return <li key={item.termId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link href={`/edit/${item.termSlug}`} className="min-w-0 break-words text-sm font-semibold text-ink hover:text-brand">{item.termName}</Link>
                <span className={cx("rounded-full px-2 py-1 text-[11px] font-semibold", status.className)}>{status.label}</span>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                {item.requestMode === "manual" ? `${item.requestedByName ?? "API 사용자"}의 수동 요청` : "자동 요청"}
                {" · "}대상 리비전 {item.revision}{" · "}
                <time dateTime={item.requestedAt} title={absoluteTime(item.requestedAt)}>{relativeTime(new Date(item.requestedAt))} 요청</time>
              </p>
              <p className="mt-0.5 text-xs text-ink-3">{timingLabel(item)}</p>
              {item.errorMessage && <p className="mt-1 max-w-2xl break-words text-xs text-danger">{item.errorMessage}</p>}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              {item.status === "failed" && <>
                <Link href={`/edit/${item.termSlug}`} className="btn-quiet btn-sm">원문 확인</Link>
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  disabled={!aiAvailable || busyAction !== null}
                  title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : undefined}
                  onClick={() => void retry(item)}
                >
                  {busyAction === item.termId ? "요청 중…" : "다시 요청"}
                </button>
              </>}
              {item.status === "ready" && <Link href={`/contribute?tab=agent&termId=${encodeURIComponent(item.termId)}`} className="btn-primary btn-sm">제안 검토</Link>}
            </div>
          </li>;
        })}
      </ul> : <p className="px-4 py-12 text-center text-sm text-ink-3">
        {queue.counts.total === 0 ? "아직 AI 작업이 없습니다. 정리 대기에서 AI 검토를 요청하면 여기서 진행 상태를 확인할 수 있습니다." : queue.filter === "attention" ? "지금 조치할 AI 작업이 없습니다. 전체 작업에서 진행 중인 항목을 확인하세요." : "이 상태의 AI 작업이 없습니다."}
      </p>}

      {queue.filteredTotal > queue.pageSize && <nav aria-label="AI 작업 페이지" className="flex items-center justify-center gap-3 border-t border-line px-4 py-3 text-xs">
        {queue.page > 1 && <Link href={queueHref(queue.filter, queue.page - 1)} className="btn-quiet btn-sm">이전</Link>}
        <span>{queue.page} / {totalPages}페이지 · 총 {queue.filteredTotal.toLocaleString("ko-KR")}개</span>
        {queue.page < totalPages && <Link href={queueHref(queue.filter, queue.page + 1)} className="btn-quiet btn-sm">다음</Link>}
      </nav>}

      {message && <p role={message.kind === "bad" ? "alert" : "status"} aria-live="polite" className={cx("border-t border-line px-4 py-2.5 text-xs", message.kind === "bad" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{message.text}</p>}
    </div>
  </section>;
}
