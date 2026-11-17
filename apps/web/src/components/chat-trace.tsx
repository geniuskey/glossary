import { cx } from "@/lib/ui/format";
import { formatTraceDuration, summarizeTrace, type ChatTraceStep } from "@/lib/ai/chat-trace-values";

const KIND_LABELS: Record<ChatTraceStep["kind"], string> = {
  task: "진행",
  plan: "검토",
  search: "검색",
  answer: "답변",
};

function StepIcon({ status }: { status: ChatTraceStep["status"] }) {
  if (status === "running") {
    return <span aria-hidden="true" className="mt-1 size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-brand border-r-transparent motion-reduce:animate-none" />;
  }
  return (
    <span aria-hidden="true" className={cx("mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold leading-none", status === "failed" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
      {status === "failed" ? "✕" : "✓"}
    </span>
  );
}

function StepList({ steps }: { steps: readonly ChatTraceStep[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-2 text-xs leading-5">
          <StepIcon status={step.status} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="shrink-0 rounded bg-panel-2 px-1 text-[10px] font-medium text-ink-3">{KIND_LABELS[step.kind]}</span>
              <span className={cx("break-words", step.status === "running" ? "text-ink" : step.status === "failed" ? "text-danger" : "text-ink-2")}>{step.label}</span>
              {step.resultCount !== undefined && (
                <span className={cx("text-[11px] tabular-nums", step.resultCount ? "text-brand" : "text-ink-3")}>근거 {step.resultCount}개</span>
              )}
              {step.durationMs !== undefined && <span className="text-[11px] tabular-nums text-ink-3">{formatTraceDuration(step.durationMs)}</span>}
            </div>
            {step.detail && <p className={cx("mt-0.5 break-words text-[11px] text-ink-3", step.kind === "plan" && "italic")}>{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 진행 중에는 단계를 펼쳐 보여 주고, 끝난 답변에는 접어 둔다. 답보다 과정이 먼저 눈에 들어오면 답을 찾기 어렵다. */
export function ChatTrace({ steps, live = false, elapsedMs }: { steps: readonly ChatTraceStep[]; live?: boolean; elapsedMs?: number }) {
  if (live) {
    return (
      <div className="min-w-0">
        <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">작업 중</span>
          {elapsedMs !== undefined && <span className="tabular-nums">{formatTraceDuration(elapsedMs)}</span>}
          <span className="hidden sm:inline">· <kbd className="font-sans">Esc</kbd>로 중단</span>
        </p>
        {steps.length > 0 ? <StepList steps={steps} /> : <p className="text-xs text-ink-3">요청을 보내는 중…</p>}
      </div>
    );
  }
  if (!steps.length) return null;
  const summary = summarizeTrace(steps);
  const failed = steps.some((step) => step.status === "failed");
  return (
    <details className="group mb-2 rounded-lg border border-line/70 bg-panel-2/40 px-2.5 py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        <span>작업 과정 {steps.length}단계</span>
        {summary.searches > 0 && <span>· 검색 {summary.searches}회</span>}
        {summary.durationMs > 0 && <span className="tabular-nums">· {formatTraceDuration(summary.durationMs)}</span>}
        {failed && <span className="text-danger">· 중단됨</span>}
      </summary>
      <div className="mt-2 border-t border-line/60 pt-2"><StepList steps={steps} /></div>
    </details>
  );
}
