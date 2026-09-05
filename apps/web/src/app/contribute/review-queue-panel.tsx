import Link from "next/link";
import type { ReviewQueueSnapshot, ReviewQueueStatus } from "@/lib/ai/auto-review";
import { cx, relativeTime } from "@/lib/ui/format";

const STATUS: Record<ReviewQueueStatus, { label: string; className: string }> = {
  queued: { label: "대기", className: "bg-warn-soft text-warn" },
  processing: { label: "검토 중", className: "bg-brand-soft text-brand" },
  ready: { label: "완료", className: "bg-ok-soft text-ok" },
  failed: { label: "실패", className: "bg-danger-soft text-danger" },
};

export function ReviewQueuePanel({ queue }: { queue: ReviewQueueSnapshot }) {
  const metrics = [
    ["현재 처리 중", queue.counts.active],
    ["대기", queue.counts.queued],
    ["검토 중", queue.counts.processing],
    ["완료", queue.counts.ready],
    ["실패", queue.counts.failed],
  ] as const;

  return <section aria-label="AI 검토 큐" className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {metrics.map(([label, value], index) => <div key={label} className={cx("card px-3 py-3", index === 0 && "border-brand/30 bg-brand-soft/25")}>
        <p className="text-[11px] font-medium text-ink-3">{label}</p>
        <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value.toLocaleString("ko-KR")}</p>
      </div>)}
    </div>

    <div className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">큐에 등록된 용어</h2>
          <p className="mt-0.5 text-xs text-ink-3">현재 리비전 기준 총 {queue.counts.total.toLocaleString("ko-KR")}개</p>
        </div>
        <Link href="/contribute?tab=queue" className="btn-quiet btn-sm ml-auto">새로고침</Link>
      </header>
      {queue.items.length > 0 ? <ul className="divide-y divide-line">
        {queue.items.map((item) => {
          const status = STATUS[item.status];
          return <li key={item.termId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/edit/${item.termSlug}`} className="truncate text-sm font-semibold text-ink hover:text-brand">{item.termName}</Link>
              <p className="mt-0.5 text-xs text-ink-3">
                {item.requestMode === "manual" ? `${item.requestedByName ?? "API 사용자"}의 수동 요청` : "자동 요청"}
                {" · "}리비전 {item.revision}{" · "}{relativeTime(new Date(item.requestedAt))}
              </p>
              {item.errorMessage && <p className="mt-1 text-xs text-danger">{item.errorMessage}</p>}
            </div>
            <span className={cx("rounded-full px-2 py-1 text-[11px] font-semibold", status.className)}>{status.label}</span>
            {item.status === "ready" && <Link href="/contribute?tab=agent" className="btn-quiet btn-sm">제안 보기</Link>}
          </li>;
        })}
      </ul> : <p className="px-4 py-12 text-center text-sm text-ink-3">아직 AI 검토 큐에 등록된 용어가 없습니다.</p>}
    </div>
  </section>;
}
