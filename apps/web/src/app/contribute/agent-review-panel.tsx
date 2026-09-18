"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparedReview } from "@/lib/ai/auto-review";
import type { ContributionSuggestion } from "@/lib/ai/contribution-suggestions";
import { buildRuleSuggestions, suggestionPatch } from "@/lib/ai/contribution-suggestions";
import type { ContributionTerm } from "@/lib/terms/query";
import { displayName, cx } from "@/lib/ui/format";
import { AgentTermList } from "./agent-term-list";

type Message = { kind: "ok" | "bad"; text: string } | null;
type Busy = { kind: "approve" | "reject"; id: string } | null;

const FIELD_LABEL = {
  definitionMd: "한줄 정의",
  domain: "도메인",
  category: "업무 분야",
  relation: "용어 관계",
} as const;

const RELATION_LABEL = {
  related_to: "관련됨",
  is_a: "하위 개념",
  part_of: "구성 요소",
  used_in: "사용됨",
  prerequisite_of: "선행 조건",
  replaces: "대체함",
} as const;

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status}).`;
}

function valueText(value: ContributionSuggestion["value"], field?: ContributionSuggestion["field"], categoryLabels?: Record<string, string>): string {
  if (field === "relation" && !Array.isArray(value) && typeof value === "object") {
    return `${value.targetName} · ${RELATION_LABEL[value.relationType]} · 신뢰도 ${value.confidence}%`;
  }
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value.map((item) => field === "category" ? categoryLabels?.[item] ?? item : item).join(" · ");
}

export function AgentReviewPanel({ initialTerms, initialTermId, totalTerms, autoReviewEnabled, initialReviews, categoryLabels }: {
  initialTerms: ContributionTerm[];
  initialTermId?: string;
  totalTerms?: number;
  autoReviewEnabled: boolean;
  initialReviews: Record<string, PreparedReview>;
  categoryLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [terms, setTerms] = useState(initialTerms);
  const [index, setIndex] = useState(() => {
    const selected = initialTerms.findIndex((term) => term.id === initialTermId);
    if (selected >= 0) return selected;
    const actionable = initialTerms.findIndex((term) => (
      initialReviews[term.id]?.revision === term.revision
      && initialReviews[term.id]!.suggestions.length > 0
    ) || buildRuleSuggestions(term).length > 0);
    return actionable >= 0 ? actionable : 0;
  });
  const [reviews, setReviews] = useState(initialReviews);
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [lastRejected, setLastRejected] = useState<ContributionSuggestion | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<Message>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const current = terms[index];
  const storedReview = current ? reviews[current.id] : undefined;
  const prepared = storedReview?.revision === current?.revision ? storedReview : undefined;
  const agentSuggestions = prepared && prepared.revision === current?.revision ? prepared.suggestions : [];
  const readyCount = terms.filter((term) => reviews[term.id]?.revision === term.revision).length;
  const suggestions = useMemo(() => {
    if (!current) return [];
    const agentFields = new Set(agentSuggestions.map((item) => item.field));
    return [...agentSuggestions, ...buildRuleSuggestions(current).filter((item) => !agentFields.has(item.field))]
      .filter((item) => !rejectedIds.includes(item.id));
  }, [agentSuggestions, current, rejectedIds]);

  useEffect(() => {
    setPollError(null);
    if (!autoReviewEnabled || !current || prepared) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/contributions/suggestions?termId=${encodeURIComponent(current.id)}&revision=${current.revision}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 200) {
          const body = await response.json() as { review: PreparedReview };
          if (!controller.signal.aborted) setReviews((items) => ({ ...items, [current.id]: body.review }));
          return;
        }
        if (response.status !== 202) throw new Error(await responseMessage(response, "검토 결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요"));
        if (++attempts >= 20) throw new Error("검토가 예상보다 오래 걸리고 있습니다. 다시 확인하거나 AI 작업에서 진행 상태를 확인해 주세요.");
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1_500);
      } catch (error) {
        if (!controller.signal.aborted) setPollError(error instanceof Error ? error.message : "연결을 확인하고 다시 시도해 주세요.");
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [autoReviewEnabled, current, prepared, retry]);

  function move(offset: number) {
    if (terms.length === 0) return;
    const nextIndex = (index + offset + terms.length) % terms.length;
    const nextTerm = terms[nextIndex];
    if (!nextTerm) return;
    setIndex(nextIndex);
    router.replace(`/contribute?tab=agent&termId=${encodeURIComponent(nextTerm.id)}`, { scroll: false });
    setRejectedIds([]);
    setLastRejected(null);
    setMessage(null);
  }

  async function approve(suggestion: ContributionSuggestion) {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy({ kind: "approve", id: suggestion.id });
    setMessage(null);
    try {
      if (suggestion.field === "relation") {
        if (!prepared) throw new Error("관계 제안이 오래되었습니다. 새 검토를 기다려 주세요.");
        const response = await fetch("/api/v1/contributions/suggestions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ termId: current.id, revision: current.revision, suggestionId: suggestion.id, decision: "approved" }),
        });
        if (!response.ok) throw new Error(await responseMessage(response, "관계 제안을 승인하지 못했습니다"));
        setReviews((items) => ({ ...items, [current.id]: { ...prepared, suggestions: prepared.suggestions.filter((item) => item.id !== suggestion.id) } }));
        setMessage({ kind: "ok", text: "용어 관계를 저장했습니다. 챗봇이 관련 용어를 찾을 때 참고합니다." });
        return;
      }
      const response = await fetch(`/api/v1/terms/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...suggestionPatch(suggestion), expectedRevision: current.revision }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "제안을 승인하지 못했습니다"));
      const body = await response.json() as { term: { definitionMd: string | null; domain: string[]; categories: string[] } };
      setTerms((items) => items.map((term, termIndex) => termIndex === index ? {
        ...term,
        definitionMd: body.term.definitionMd,
        domain: body.term.domain,
        categories: body.term.categories,
        categoryLabels: suggestion.field === "category" && Array.isArray(suggestion.value)
          ? suggestion.value.map((key) => categoryLabels[key] ?? key)
          : term.categoryLabels,
        revision: term.revision + 1,
      } : term));
      setReviews((items) => {
        const review = items[current.id];
        if (!review) return items;
        return { ...items, [current.id]: { ...review, revision: current.revision + 1, suggestions: review.suggestions.filter((item) => item.id !== suggestion.id) } };
      });
      setRejectedIds((items) => [...items, suggestion.id]);
      setLastRejected(null);
      setMessage({ kind: "ok", text: `${FIELD_LABEL[suggestion.field]} 제안을 승인해 저장했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "제안을 승인하지 못했습니다." });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function reject(suggestion: ContributionSuggestion) {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy({ kind: "reject", id: suggestion.id });
    setMessage(null);
    try {
      if (suggestion.field === "relation") {
        if (!prepared) throw new Error("관계 제안이 오래되었습니다. 새 검토를 기다려 주세요.");
        const response = await fetch("/api/v1/contributions/suggestions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ termId: current.id, revision: current.revision, suggestionId: suggestion.id, decision: "rejected" }),
        });
        if (!response.ok) throw new Error(await responseMessage(response, "관계 제안을 거절하지 못했습니다"));
        setReviews((items) => ({ ...items, [current.id]: { ...prepared, suggestions: prepared.suggestions.filter((item) => item.id !== suggestion.id) } }));
      } else if (suggestion.source === "agent" && prepared) {
        const response = await fetch("/api/v1/contributions/suggestions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ termId: current.id, revision: current.revision, suggestionId: suggestion.id }),
        });
        if (!response.ok) throw new Error(await responseMessage(response, "제안을 거절하지 못했습니다"));
        setReviews((items) => ({ ...items, [current.id]: { ...prepared, suggestions: prepared.suggestions.filter((item) => item.id !== suggestion.id) } }));
      }
      setRejectedIds((items) => [...items, suggestion.id]);
      setLastRejected(suggestion.source === "rule" ? suggestion : null);
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "제안을 거절하지 못했습니다." });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function undoReject() {
    if (!current || !lastRejected) return;
    setRejectedIds((items) => items.filter((id) => id !== lastRejected.id));
    setLastRejected(null);
  }

  if (!current) return (
    <div className="card px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink">검토할 용어가 없습니다.</p>
      <p className="mt-1 text-xs text-ink-3">공동 정리 대기열에 용어가 들어오면 여기에서 제안을 검토할 수 있습니다.</p>
    </div>
  );

  return (
    <section aria-label="용어 수정 제안 검토" className="mt-5">
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <AgentTermList
          terms={terms}
          reviews={reviews}
          selectedTermId={current.id}
          totalTerms={totalTerms ?? terms.length}
          autoReviewEnabled={autoReviewEnabled}
        />
        <div className="card min-w-0 overflow-hidden">
        <header className="border-b border-line bg-panel-2/55 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{displayName(current)}</p>
              <p className="truncate font-mono text-[11px] text-ink-3">/{current.slug}</p>
            </div>
          <Link href={`/contribute?tab=duplicates&term=${encodeURIComponent(current.slug)}`} className="btn-quiet btn-sm ml-auto">중복 후보 검토</Link>
            <Link href={`/edit/${current.slug}`} className="btn-quiet btn-sm">직접 편집</Link>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2 border-t border-line/70 pt-2 sm:mt-0 sm:border-0 sm:pt-0">
            <span className="mr-auto font-mono text-xs tabular-nums text-ink-3 sm:mr-1">{index + 1} / {terms.length}</span>
            {autoReviewEnabled && <span className="text-xs text-ink-3">자동 검토 {readyCount}/{terms.length}</span>}
            <button type="button" className="btn-quiet btn-sm" disabled={terms.length <= 1 || busy !== null} onClick={() => move(-1)}>이전</button>
            <button type="button" className="btn-quiet btn-sm" disabled={terms.length <= 1 || busy !== null} onClick={() => move(1)}>다음</button>
          </div>
        </header>

        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:p-5">
          <div className="min-w-0 space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-2">현재 한줄 정의</p>
              <p className="rounded-lg border border-line bg-panel-2/45 p-3 text-sm leading-6 text-ink-2">{current.definitionMd || "아직 없습니다."}</p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-2">현재 분류</p>
              <p className="text-sm text-ink-2">도메인 {current.domain.join(" · ") || "없음"}</p>
              <p className="mt-1 text-sm text-ink-2">업무 분야 {current.categoryLabels.join(" · ") || "없음"}</p>
            </div>
            {current.bodyMd && <div><p className="mb-1.5 text-xs font-semibold text-ink-2">본문 근거</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2/45 p-3 font-sans text-xs leading-5 text-ink-2">{current.bodyMd}</pre></div>}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">검토할 제안</h2>
              <span className="text-xs tabular-nums text-ink-3">{suggestions.length}개</span>
              {!prepared && autoReviewEnabled && !pollError && <span className="ml-auto text-xs text-brand" role="status">자동 검토 준비 중…</span>}
              {prepared && <span className="ml-auto text-xs text-ok" role="status">AI 검토 완료</span>}
            </div>
            {pollError && <div role="alert" className="mb-3 rounded-lg bg-warn-soft p-3 text-xs text-ink">
              <p>{pollError}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-quiet btn-sm" onClick={() => setRetry((value) => value + 1)}>다시 확인</button>
                <Link href="/contribute?tab=queue" className="btn-quiet btn-sm">진행 상태 보기</Link>
                <a href={`/contribute?tab=agent&termId=${encodeURIComponent(current.id)}`} className="btn-quiet btn-sm">최신 내용 불러오기</a>
              </div>
            </div>}
            {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3 rounded-lg px-3 py-2 text-xs", message.kind === "bad" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{message.text}</p>}
            {lastRejected && (
              <p role="status" className="mb-3 flex items-center gap-2 rounded-lg bg-panel-2 px-3 py-2 text-xs text-ink-2">
                {FIELD_LABEL[lastRejected.field]} 제안을 이번에 건너뛰었습니다.
                <button type="button" className="link ml-auto" onClick={undoReject}>실행 취소</button>
              </p>
            )}
            <div className="space-y-3">
              {suggestions.length > 0 ? suggestions.map((suggestion) => (
                <article key={suggestion.id} className="rounded-xl border border-line p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx("chip !py-0.5 !text-[11px]", suggestion.source === "agent" && "chip-on")}>{suggestion.source === "rule" ? "규칙" : "AI 판단"}</span>
                    <span className="text-xs font-semibold text-ink-2">{FIELD_LABEL[suggestion.field]}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-lg bg-panel-2/60 px-3 py-2 text-ink-3">
                      <span className="mr-2 text-[11px] font-semibold">현재</span>
                      <span className="break-words">{suggestion.field === "definitionMd" ? current.definitionMd || "없음" : suggestion.field === "domain" ? current.domain.join(" · ") || "없음" : suggestion.field === "category" ? current.categoryLabels.join(" · ") || "없음" : "새 관계 추가"}</span>
                    </div>
                    <div className="rounded-lg border border-brand/25 bg-brand-soft/45 px-3 py-2 text-ink">
                      <span className="mr-2 text-[11px] font-semibold text-brand">제안</span>
                      <span className="break-words font-medium">{valueText(suggestion.value, suggestion.field, categoryLabels)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-ink-3">{suggestion.reason}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="btn-quiet btn-sm" disabled={busy !== null} onClick={() => void reject(suggestion)}>{busy?.kind === "reject" && busy.id === suggestion.id ? "처리 중…" : suggestion.source === "rule" ? "이번에 건너뛰기" : "거절"}</button>
                    <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void approve(suggestion)}>{busy?.kind === "approve" && busy.id === suggestion.id ? "저장 중…" : "승인하고 저장"}</button>
                  </div>
                </article>
              )) : <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">{prepared ? "AI 검토를 마쳤으며, 현재 내용에는 제안할 변경이 없습니다." : pollError ? "검토 결과를 아직 확인하지 못했습니다." : !autoReviewEnabled ? "현재 검토할 제안이 없습니다. 직접 편집하거나 정리 대기에서 AI 검토를 요청할 수 있습니다." : "AI가 이 용어를 검토하고 있습니다…"}</p>}
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
