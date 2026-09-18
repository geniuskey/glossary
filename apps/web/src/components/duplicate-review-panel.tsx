"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  DuplicateCandidate,
  DuplicateDecision,
  DuplicateInput,
  DuplicatePairFilter,
  DuplicatePairTerm,
  DuplicateReviewCounts,
  DuplicateReviewPair,
} from "@/lib/ai/duplicate-review";

const verdictLabel = { same: "같은 개념", different: "다른 개념", uncertain: "판단 보류" } as const;
const filterLabel: Record<DuplicatePairFilter, string> = {
  pending: "검토 필요",
  uncertain: "판단 보류",
  different: "다른 개념으로 확인",
  all: "전체 후보",
};
const signalLabel = { same_surface: "같은 표기", numbered_slug: "숫자 접미사 URL" } as const;

type ReviewState = {
  pair: DuplicateReviewPair;
  source: DuplicateInput;
  revision: number;
  candidates: DuplicateCandidate[];
};
type MergeRequest = {
  source: DuplicateInput;
  target: DuplicateInput;
  sourceRevision: number;
  targetRevision: number;
};

function titleOf(term: Pick<DuplicateInput, "nameKo" | "nameEn" | "slug">): string {
  return term.nameKo || term.nameEn || term.slug || "이름 없는 용어";
}

function PairTermCard({ term, label }: { term: DuplicatePairTerm; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-panel-2 p-3">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <Link className="mt-1 block break-words font-semibold link" href={`/w/${encodeURIComponent(term.slug ?? "")}`} target="_blank" rel="noreferrer">
        {titleOf(term)}
      </Link>
      <p className="mt-1 break-all font-mono text-xs text-ink-3">/{term.slug}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-3">정식 명칭</dt>
          <dd className="break-words">{term.fullNameKo || term.fullNameEn || "없음"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">정의</dt>
          <dd className="whitespace-pre-wrap break-words">{term.definitionMd || "정의 없음"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">도메인</dt>
          <dd className="break-words">{term.domain?.join(" · ") || "없음"}</dd>
        </div>
      </dl>
    </div>
  );
}

function emptyCopy(filter: DuplicatePairFilter): string {
  if (filter === "uncertain") return "판단을 보류한 후보가 없습니다.";
  if (filter === "different") return "다른 개념으로 확인한 후보가 없습니다.";
  if (filter === "all") return "발견된 중복 후보 쌍이 없습니다.";
  return "검토할 중복 후보 쌍이 없습니다.";
}

export function DuplicateReviewPanel({
  initialQuery = "",
  initialStatus = "pending",
  aiAvailable = true,
}: {
  initialQuery?: string;
  initialStatus?: string;
  aiAvailable?: boolean;
}) {
  const normalizedStatus: DuplicatePairFilter = initialStatus === "all" || initialStatus === "uncertain" || initialStatus === "different" ? initialStatus : "pending";
  const [items, setItems] = useState<DuplicateReviewPair[]>([]);
  const [counts, setCounts] = useState<DuplicateReviewCounts>({ all: 0, pending: 0, different: 0, uncertain: 0 });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<DuplicatePairFilter>(normalizedStatus);
  const [query, setQuery] = useState(initialQuery);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [pendingMerge, setPendingMerge] = useState<MergeRequest | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const autoInspectDone = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/v1/contributions/duplicates?page=${page}&status=${filter}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "중복 후보를 불러오지 못했습니다.");
        setItems(body.items ?? []);
        setCounts(body.counts ?? { all: 0, pending: 0, different: 0, uncertain: 0 });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "중복 후보를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [filter, page, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (filter === "pending") params.delete("status"); else params.set("status", filter);
    if (page === 1) params.delete("page"); else params.set("page", String(page));
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [filter, page]);

  async function inspect(termId: string, candidateId?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setMessage(""); setReview(null); setPendingMerge(null);
    try {
      const response = await fetch("/api/v1/contributions/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(candidateId ? { termId, candidateId } : { termId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "두 용어를 비교하지 못했습니다.");
      const candidate = body.candidates?.[0];
      const pair = items.find((item) => item.left.id === termId && item.right.id === candidateId)
        ?? items.find((item) => item.left.id === termId)
        ?? {
          id: `${termId}:${candidateId ?? candidate?.id ?? ""}`,
          left: { ...body.source, revision: body.revision },
          right: candidate ? { ...candidate, revision: candidate.revision ?? 0 } : { id: candidateId ?? "", slug: candidateId ?? "", revision: 0 },
          signals: [], decision: null, decisionReason: null,
        };
      setReview({ pair, source: body.source, revision: body.revision, candidates: body.candidates ?? [] });
      setDecisionReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "두 용어를 비교하지 못했습니다.");
    } finally {
      lock.current = false; setBusy(false);
    }
  }

  async function inspectSlug(value: string) {
    const trimmed = value.trim();
    if (!trimmed || lock.current) return;
    try {
      const response = await fetch(`/api/v1/terms/${encodeURIComponent(trimmed)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "용어를 찾을 수 없습니다.");
      await inspect(body.term.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "용어를 찾을 수 없습니다.");
    }
  }

  useEffect(() => {
    if (!initialQuery || autoInspectDone.current) return;
    autoInspectDone.current = true;
    void inspectSlug(initialQuery);
  // The URL query is an explicit request to inspect one term; it should run once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  async function decide(decision: DuplicateDecision) {
    if (!review || !review.candidates[0] || lock.current) return;
    const candidate = review.candidates[0];
    if (!candidate.revision) {
      setError("후보의 최신 리비전을 확인하지 못했습니다. 다시 비교해 주세요.");
      return;
    }
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/contributions/duplicates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          leftId: review.source.id,
          rightId: candidate.id,
          leftRevision: review.revision,
          rightRevision: candidate.revision,
          decision,
          reason: decisionReason.trim() || candidate.reason,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "검토 결과를 저장하지 못했습니다.");
      setMessage(decision === "different" ? "다른 개념으로 확인했습니다." : "판단 보류로 저장했습니다.");
      setReview(null); setDecisionReason(""); setRefreshKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검토 결과를 저장하지 못했습니다.");
    } finally {
      lock.current = false; setBusy(false);
    }
  }

  function requestMerge(source: DuplicateInput, target: DuplicateInput, sourceRevision: number | undefined, targetRevision: number | undefined) {
    if (!sourceRevision || !targetRevision) {
      setError("두 용어의 최신 리비전을 확인하지 못했습니다. 다시 비교해 주세요.");
      return;
    }
    setPendingMerge({ source, target, sourceRevision, targetRevision });
  }

  async function confirmMerge() {
    if (!pendingMerge || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/contributions/duplicates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: pendingMerge.source.id,
          targetId: pendingMerge.target.id,
          sourceRevision: pendingMerge.sourceRevision,
          targetRevision: pendingMerge.targetRevision,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "병합하지 못했습니다.");
      setMessage(`“${titleOf(pendingMerge.target)}”를 대표 용어로 병합했습니다. 원본 URL은 대표 용어로 연결됩니다.`);
      setPendingMerge(null); setReview(null); setRefreshKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "병합하지 못했습니다.");
    } finally {
      lock.current = false; setBusy(false);
    }
  }

  const currentCount = filter === "all" ? counts.all : counts[filter];
  const pageCount = Math.max(1, Math.ceil(currentCount / 30));
  const aiNotice = !aiAvailable ? "AI 연결이 꺼져 있어 AI 판정은 실행되지 않을 수 있습니다. 후보 내용을 직접 확인한 뒤에도 결과를 저장할 수 있습니다." : "";

  return (
    <section className="space-y-5" aria-labelledby="duplicate-review-title">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="duplicate-review-title" className="text-xl font-semibold tracking-tight text-balance">중복 후보 검토</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">규칙이 찾아낸 후보 쌍을 비교하고, 같은 개념이면 대표 용어를 선택해 병합합니다. 다른 개념과 판단 보류도 저장해 같은 후보를 다시 반복해서 검토하지 않습니다.</p>
          </div>
          <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-xs tabular-nums text-ink-2">검토 쌍 {counts.pending.toLocaleString("ko-KR")}개</span>
        </div>
        {aiNotice && <p className="note-warn" role="status">{aiNotice}</p>}
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="중복 후보 상태 필터">
        {(Object.keys(filterLabel) as DuplicatePairFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={`btn-quiet btn-sm focus-visible:ring-2 focus-visible:ring-brand/40 ${filter === value ? "border-brand bg-brand/10 text-brand" : ""}`}
            onClick={() => { setFilter(value); setPage(1); setReview(null); setMessage(""); }}
          >
            {filterLabel[value]} <span className="font-mono tabular-nums">{(value === "all" ? counts.all : counts[value]).toLocaleString("ko-KR")}</span>
          </button>
        ))}
      </div>

      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void inspectSlug(query); }}>
        <label className="min-w-0 flex-1 text-xs text-ink-2">직접 검토할 용어 URL 슬러그
          <input name="term" aria-label="직접 검토할 용어 URL 슬러그" className="mt-1 block w-full rounded-lg border border-line bg-panel p-2 text-sm text-ink" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: auto-exposure-2…" autoComplete="off" />
        </label>
        <button type="submit" className="btn-primary self-end" disabled={busy || !query.trim()}>AI 판정 요청</button>
      </form>

      {busy && <p role="status" aria-live="polite">처리 중…</p>}
      {error && <p role="alert" className="note-danger">{error}</p>}
      {message && <p role="status" aria-live="polite" className="note-warn">{message}</p>}

      {review && (
        <div className="card space-y-4 border-brand/40 p-4" aria-labelledby="duplicate-comparison-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="duplicate-comparison-title" className="font-semibold">두 용어 비교</h2>
              <p className="mt-1 text-xs text-ink-3">AI는 판정 보조입니다. 최종 병합·분리·보류 결정은 사람이 선택합니다.</p>
            </div>
            <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => { setReview(null); setPendingMerge(null); }}>비교 닫기</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <PairTermCard term={review.pair.left} label="용어 A" />
            <PairTermCard term={review.pair.right} label="용어 B" />
          </div>
          {review.candidates.length === 0 && <p className="text-sm text-ink-2">비교할 후보가 없습니다. 용어의 표기나 URL을 다시 확인해 주세요.</p>}
          {review.candidates.map((candidate) => (
            <article key={candidate.id} className="space-y-3 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${candidate.verdict === "same" ? "bg-warn-soft text-warn" : candidate.verdict === "different" ? "bg-panel-2 text-ink-2" : "bg-brand/10 text-brand"}`}>
                  AI 판단: {verdictLabel[candidate.verdict]}
                </span>
                <span className="text-xs text-ink-2">{candidate.reason}</span>
              </div>
              <label className="block text-xs text-ink-2">검토 메모(선택)
                <textarea className="mt-1 min-h-16 w-full rounded border border-line bg-panel p-2 text-sm text-ink" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="예: 정의와 도메인이 달라 별개 용어로 유지…" />
              </label>
              <div className="flex flex-wrap gap-2">
                {candidate.verdict === "same" && <>
                  <button type="button" className="btn-primary btn-sm" disabled={busy || !candidate.revision} onClick={() => requestMerge(candidate, review.source, candidate.revision, review.revision)}>
                    “{titleOf(review.source)}”를 대표로 병합
                  </button>
                  <button type="button" className="btn-primary btn-sm" disabled={busy || !candidate.revision} onClick={() => requestMerge(review.source, candidate, review.revision, candidate.revision)}>
                    “{titleOf(candidate)}”를 대표로 병합
                  </button>
                </>}
                <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void decide("different")}>다른 개념으로 유지</button>
                <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void decide("uncertain")}>판단 보류</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pendingMerge && (
        <div className="card space-y-3 border-warn/50 bg-warn-soft p-4" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-merge-confirm-title">
          <h2 id="duplicate-merge-confirm-title" className="font-semibold">병합을 확인해 주세요</h2>
          <p className="text-sm text-ink-2">“{titleOf(pendingMerge.source)}”를 보관하고 “{titleOf(pendingMerge.target)}”를 대표 용어로 사용합니다. 양쪽 표기·분류·본문은 대표 용어에 보존되고, 원본 URL은 대표 용어로 연결됩니다.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void confirmMerge()}>병합 실행</button>
            <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => setPendingMerge(null)}>취소</button>
          </div>
        </div>
      )}

      <div className="space-y-3" aria-label="중복 후보 쌍 목록">
        {items.map((pair) => (
          <article key={pair.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-panel-2 px-2 py-0.5 font-medium text-ink-2">{pair.decision ? filterLabel[pair.decision] : "검토 필요"}</span>
                {pair.signals.map((signal) => <span key={signal} className="rounded-full border border-line px-2 py-0.5 text-ink-3">{signalLabel[signal]}</span>)}
              </div>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void inspect(pair.left.id, pair.right.id)}>두 용어 비교</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <PairTermCard term={pair.left} label="용어 A" />
              <PairTermCard term={pair.right} label="용어 B" />
            </div>
            {pair.decisionReason && <p className="text-xs text-ink-3">검토 메모: {pair.decisionReason}</p>}
          </article>
        ))}
        {!items.length && !error && <div className="card px-5 py-12 text-center"><p className="text-sm font-medium text-ink">{emptyCopy(filter)}</p><p className="mt-1 text-xs text-ink-3">새 용어를 등록하거나 다른 상태 필터를 확인해 주세요.</p></div>}
      </div>

      {currentCount > 0 && <nav aria-label="중복 후보 페이지" className="flex items-center justify-center gap-3 text-xs">
        <button type="button" className="btn-quiet btn-sm" disabled={busy || page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</button>
        <span className="tabular-nums">{page} / {pageCount}페이지 · {currentCount.toLocaleString("ko-KR")}쌍</span>
        <button type="button" className="btn-quiet btn-sm" disabled={busy || page >= pageCount} onClick={() => setPage((value) => value + 1)}>다음</button>
      </nav>}
    </section>
  );
}
