"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiObservabilitySnapshot } from "@/lib/ai/observability-values";
import type { ReviewQueueSnapshot } from "@/lib/ai/auto-review";
import type { RagIndexStats } from "@/lib/rag/config-values";

interface Props {
  initialSnapshot: AiObservabilitySnapshot;
  initialQueues: { rag: RagIndexStats; review: ReviewQueueSnapshot };
  initialReadiness: { aiEnabled: boolean; aiSecretsReadable: boolean; ragEnabled: boolean; ragSecretsReadable: boolean };
}

interface Payload {
  snapshot: AiObservabilitySnapshot;
  queues: { rag: RagIndexStats; review: ReviewQueueSnapshot };
  readiness: {
    ai: { enabled: boolean; secretsReadable: boolean };
    rag: { enabled: boolean; secretsReadable: boolean };
  };
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value).toLocaleString("ko-KR")}ms`;
}

function tokens(value: number): string {
  return value.toLocaleString("ko-KR");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function windowLabel(value: number): string {
  if (value % 24 === 0) return `${value / 24}일`;
  return `${value}시간`;
}

function age(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}분 전`;
  return `${Math.floor(seconds / 3_600)}시간 전`;
}

export function AiObservabilityPanel({ initialSnapshot, initialQueues, initialReadiness }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [queues, setQueues] = useState(initialQueues);
  const [readiness, setReadiness] = useState(initialReadiness);
  const [hours, setHours] = useState(initialSnapshot.windowHours);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async (requestedHours = hours) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/admin/ai-observability?hours=${requestedHours}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as Payload | { error?: { message?: string } } | null;
      if (!response.ok || !body || !("snapshot" in body)) {
        setMessage((body && "error" in body ? body.error?.message : undefined) || `새로고침하지 못했습니다 (${response.status}).`);
        return;
      }
      setSnapshot(body.snapshot);
      setQueues(body.queues);
      setReadiness({
        aiEnabled: body.readiness.ai.enabled,
        aiSecretsReadable: body.readiness.ai.secretsReadable,
        ragEnabled: body.readiness.rag.enabled,
        ragSecretsReadable: body.readiness.rag.secretsReadable,
      });
      setMessage(null);
    } catch {
      setMessage("모니터링 데이터를 새로고침하지 못했습니다.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const alerts = useMemo(() => {
    const items: string[] = [];
    if (!readiness.aiEnabled || !readiness.aiSecretsReadable) items.push("챗·에이전트 AI 연결이 준비되지 않았습니다.");
    if (readiness.ragEnabled && !readiness.ragSecretsReadable) items.push("RAG 비밀값을 읽을 수 없습니다.");
    if (snapshot.summary.failed > 0 && snapshot.summary.successRate < 0.9) items.push("AI 호출 실패율이 10%를 넘었습니다.");
    if (queues.rag.failed > 0) items.push(`RAG 색인 실패 ${queues.rag.failed.toLocaleString("ko-KR")}건이 있습니다.`);
    if (queues.review.counts.failed > 0) items.push(`AI 검토 실패 ${queues.review.counts.failed.toLocaleString("ko-KR")}건이 있습니다.`);
    return items;
  }, [queues, readiness, snapshot]);

  return (
    <section aria-labelledby="ai-observability-heading">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 id="ai-observability-heading" className="text-lg font-semibold tracking-tight text-ink">AI 운영</h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-2">최근 {windowLabel(hours)}의 LLM·Embedding·Reranker 실행 상태를 확인합니다. 프롬프트와 답변 원문은 저장하지 않습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="ai-observability-hours">집계 기간</label>
          <select id="ai-observability-hours" className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink" value={hours} onChange={(event) => { const next = Number(event.target.value); setHours(next); void refresh(next); }} disabled={loading}>
            <option value={24}>최근 24시간</option>
            <option value={72}>최근 3일</option>
            <option value={168}>최근 7일</option>
            <option value={720}>최근 30일</option>
          </select>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void refresh()} disabled={loading}>{loading ? "새로고침 중…" : "새로고침"}</button>
        </div>
      </header>

      {alerts.length > 0 && <div className="note note-warn mb-4" role="alert"><p className="font-medium">운영 확인 필요</p><ul className="mt-1 list-disc space-y-1 pl-5">{alerts.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {message && <p className="mb-4 text-sm text-danger" role="alert">{message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="호출" value={snapshot.summary.requests.toLocaleString("ko-KR")} hint={`${snapshot.summary.running}건 실행 중`} />
        <Metric label="성공률" value={percent(snapshot.summary.successRate)} hint={`${snapshot.summary.failed}건 실패`} tone={snapshot.summary.successRate < 0.9 && snapshot.summary.requests > 0 ? "warn" : "normal"} />
        <Metric label="P95 지연" value={ms(snapshot.summary.p95LatencyMs)} hint={`평균 ${ms(snapshot.summary.averageLatencyMs)}`} />
        <Metric label="토큰" value={tokens(snapshot.summary.totalTokens)} hint={`입력 ${tokens(snapshot.summary.inputTokens)} · 출력 ${tokens(snapshot.summary.outputTokens)}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">작업별 실행</h3></div>
          {snapshot.operations.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-3">선택한 기간에 기록된 AI 호출이 없습니다.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-panel-2/50 text-ink-3"><tr><th className="px-4 py-2.5 font-medium">작업</th><th className="px-4 py-2.5 font-medium">모델</th><th className="px-4 py-2.5 text-right font-medium">호출</th><th className="px-4 py-2.5 text-right font-medium">실패</th><th className="px-4 py-2.5 text-right font-medium">P95</th><th className="px-4 py-2.5 text-right font-medium">토큰</th></tr></thead><tbody className="divide-y divide-line">{snapshot.operations.map((row) => <tr key={`${row.operation}:${row.provider}:${row.model}`}><td className="px-4 py-2.5 font-medium text-ink">{row.operation}<span className="mt-0.5 block text-[11px] font-normal text-ink-3">{row.provider}</span></td><td className="max-w-48 truncate px-4 py-2.5 font-mono text-[11px] text-ink-2">{row.model}</td><td className="px-4 py-2.5 text-right tabular-nums text-ink">{row.requests}</td><td className="px-4 py-2.5 text-right tabular-nums text-danger">{row.failed}</td><td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{ms(row.p95LatencyMs)}</td><td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{tokens(row.totalTokens)}</td></tr>)}</tbody></table></div>}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">큐 상태</h3></div>
          <div className="space-y-3 p-4 text-sm"><QueueRow label="RAG 색인" queued={queues.rag.queued} processing={queues.rag.processing} failed={queues.rag.failed} /><QueueRow label="AI 검토" queued={queues.review.counts.queued} processing={queues.review.counts.processing} failed={queues.review.counts.failed} /></div>
          <div className="border-t border-line px-4 py-3 text-xs text-ink-3">마지막 색인: {queues.rag.lastIndexedAt ? age(queues.rag.lastIndexedAt) : "없음"}</div>
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">최근 실패</h3></div>
        {snapshot.recentFailures.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-3">최근 실패한 호출이 없습니다.</p> : <div className="divide-y divide-line">{snapshot.recentFailures.map((failure) => <div key={failure.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-xs"><span className="font-medium text-danger">{failure.errorCode || "failed"}</span><span className="font-medium text-ink">{failure.operation}</span><span className="font-mono text-ink-3">{failure.model}</span><span className="font-mono text-ink-3" title={failure.traceId}>trace {failure.traceId.slice(0, 8)}</span><span className="text-ink-3">시도 {failure.attempts}회 · {failure.httpStatus ?? "네트워크"} · {age(failure.startedAt)}</span>{failure.errorMessage && <p className="basis-full truncate text-ink-2">{failure.errorMessage}</p>}</div>)}</div>}
      </div>
      <p className="mt-3 text-right text-[11px] text-ink-3">집계 기준: {new Date(snapshot.since).toLocaleString("ko-KR")} 이후 · {new Date(snapshot.generatedAt).toLocaleTimeString("ko-KR")}</p>
    </section>
  );
}

function Metric({ label, value, hint, tone = "normal" }: { label: string; value: string; hint: string; tone?: "normal" | "warn" }) {
  return <div className="card px-4 py-3"><p className="text-xs text-ink-3">{label}</p><p className={tone === "warn" ? "mt-1 text-2xl font-semibold tabular-nums text-danger" : "mt-1 text-2xl font-semibold tabular-nums text-ink"}>{value}</p><p className="mt-1 text-[11px] text-ink-3">{hint}</p></div>;
}

function QueueRow({ label, queued, processing, failed }: { label: string; queued: number; processing: number; failed: number }) {
  return <div><div className="flex items-center justify-between"><span className="font-medium text-ink">{label}</span><span className={failed ? "font-mono text-danger" : "font-mono text-ink-2"}>{failed} 실패</span></div><p className="mt-1 text-xs text-ink-3">대기 {queued.toLocaleString("ko-KR")} · 처리 중 {processing.toLocaleString("ko-KR")}</p></div>;
}
