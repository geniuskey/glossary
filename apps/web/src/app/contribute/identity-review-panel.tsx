"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type {
  IdentityAction,
  IdentityField,
  IdentityReview,
  IdentityReviewCandidate,
  IdentityReviewSource,
  IdentityReviewSuggestion,
  IdentitySurfaceValue,
} from "@/lib/ai/identity-review";
import { AI_SUGGESTION_GENERATOR_VERSIONS } from "@/lib/ai/suggestion-disposition-values";
import { cx } from "@/lib/ui/format";
import { SuggestionDispositionActions } from "./suggestion-disposition-actions";

type Message = { kind: "ok" | "bad"; text: string } | null;
type AutoProgress = { active: boolean; total: number; completed: number };

export type IdentityReviewView = "all" | "issues" | "enrichment" | "pending";

const VIEW_LABEL: Record<IdentityReviewView, string> = {
  all: "전체 대상",
  issues: "규칙 확인 대상",
  enrichment: "AI 문맥 보완 대상",
  pending: "AI 검토 대기",
};

const FIELD_LABEL: Record<IdentityField, string> = {
  nameEn: "대표 영문 표기",
  nameKo: "대표 국문 표기",
  fullNameEn: "영문 확장명",
  fullNameKo: "국문 확장명",
  surface: "추가 표기",
};

const ACTION_LABEL: Record<IdentityAction, string> = {
  fill: "채우기",
  replace: "수정",
  add: "추가",
  reclassify: "종류 변경",
  remove: "삭제 후보",
};

const SURFACE_KIND_LABEL: Record<IdentitySurfaceValue["kind"], string> = {
  canonical: "표준 표기",
  abbreviation: "약어",
  full_name: "확장명",
  alias: "별칭",
  discouraged: "비권장",
  forbidden: "금지",
};

function errorMessage(response: Response, fallback: string): Promise<string> {
  return response.json()
    .catch(() => null)
    .then((body) => (body as { error?: { message?: string } } | null)?.error?.message ?? `${fallback} (${response.status})`);
}

function stringValue(suggestion: IdentityReviewSuggestion): string | null {
  return typeof suggestion.value === "string" ? suggestion.value : null;
}

function surfaceValue(suggestion: IdentityReviewSuggestion): IdentitySurfaceValue | null {
  return typeof suggestion.value === "object" && suggestion.value !== null ? suggestion.value : null;
}

function valueText(value: string | IdentitySurfaceValue): string {
  return typeof value === "string" ? value : `${value.text} · ${SURFACE_KIND_LABEL[value.kind]}`;
}

function identityPageHref(query: string, view: IdentityReviewView, page: number): string {
  const params = new URLSearchParams({ field: "identity", page: String(page) });
  if (query) params.set("q", query);
  if (view !== "all") params.set("view", view);
  return `/contribute/fields?${params.toString()}`;
}

function currentText(candidate: IdentityReviewCandidate, field: IdentityField): string {
  if (field === "surface") return candidate.surfaces.map((surface) => `${surface.text} (${SURFACE_KIND_LABEL[surface.kind]})`).join(", ") || "없음";
  return candidate[field] || "없음";
}

function sourceLinks(sources: readonly IdentityReviewSource[]): React.ReactNode {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
      <span>근거</span>
      {sources.map((source) => (
        <Link key={source.slug} href={`/g/${source.slug}`} target="_blank" rel="noreferrer" className="break-words rounded bg-panel-2 px-1.5 py-0.5 hover:text-brand">
          {source.title}
        </Link>
      ))}
    </div>
  );
}

export function IdentityReviewPanel({ initialCandidates, query, view, page, hasNextPage, aiAvailable }: {
  initialCandidates: IdentityReviewCandidate[];
  query: string;
  view: IdentityReviewView;
  page: number;
  hasNextPage: boolean;
  aiAvailable: boolean;
}) {
  const [candidates, setCandidates] = useState<IdentityReviewCandidate[]>(initialCandidates);
  const [reviews, setReviews] = useState<Record<string, IdentityReview | null>>(() => Object.fromEntries(
    initialCandidates.map((candidate) => [candidate.id, candidate.review]),
  ));
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>(null);
  const [autoProgress, setAutoProgress] = useState<AutoProgress>({ active: false, total: 0, completed: 0 });
  const generatingRef = useRef(new Set<string>());

  const visibleCandidates = useMemo(() => candidates.filter((candidate) => {
    if (view === "issues") return candidate.issues.length > 0;
    if (view === "enrichment") return candidate.issues.length === 0;
    if (view === "pending") return !reviews[candidate.id];
    return true;
  }), [candidates, reviews, view]);
  const pendingCandidates = useMemo(
    () => visibleCandidates.filter((candidate) => !reviews[candidate.id]),
    [reviews, visibleCandidates],
  );

  function isGenerating(termId: string): boolean {
    return generatingIds.includes(termId);
  }

  function isSaving(suggestionId: string): boolean {
    return savingIds.includes(suggestionId);
  }

  async function generate(candidate: IdentityReviewCandidate, announce = true, force = false): Promise<void> {
    if (!aiAvailable || generatingRef.current.has(candidate.id)) return;
    generatingRef.current.add(candidate.id);
    setGeneratingIds((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    setErrors((items) => {
      const next = { ...items };
      delete next[candidate.id];
      return next;
    });
    if (announce) setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/identity-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: candidate.id, expectedRevision: candidate.revision, ...(force ? { force: true } : {}) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "표기 정비 제안을 준비하지 못했습니다"));
      const body = await response.json() as { review?: IdentityReview | null };
      const review = body.review ?? null;
      setReviews((items) => ({ ...items, [candidate.id]: review }));
      if (review && review.suggestions.length === 0) {
        setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      }
      if (announce) setMessage({ kind: "ok", text: `‘${candidate.name}’의 표기 정비 제안을 준비했습니다. 필드별로 확인해 주세요.` });
    } catch (error) {
      setErrors((items) => ({ ...items, [candidate.id]: error instanceof Error ? error.message : "표기 정비 제안을 준비하지 못했습니다." }));
    } finally {
      generatingRef.current.delete(candidate.id);
      setGeneratingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  async function generateVisibleCandidates(): Promise<void> {
    if (!aiAvailable || autoProgress.active || pendingCandidates.length === 0) return;
    let cursor = 0;
    let completed = 0;
    const pending = [...pendingCandidates];
    setMessage(null);
    setAutoProgress({ active: true, total: pending.length, completed: 0 });
    const worker = async () => {
      while (true) {
        const candidate = pending[cursor];
        cursor += 1;
        if (!candidate) return;
        await generate(candidate, false, false);
        completed += 1;
        setAutoProgress({ active: true, total: pending.length, completed });
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker()));
    setAutoProgress({ active: false, total: pending.length, completed });
    setMessage({ kind: "ok", text: `${completed}개 용어의 AI 표기 검토를 마쳤습니다. 제안을 승인하거나 보류·숨김 처리해 주세요.` });
  }

  async function approve(candidate: IdentityReviewCandidate, suggestion: IdentityReviewSuggestion): Promise<void> {
    const review = reviews[candidate.id];
    if (!review || isSaving(suggestion.id) || isGenerating(candidate.id)) return;
    setSavingIds((items) => items.includes(suggestion.id) ? items : [...items, suggestion.id]);
    setMessage(null);
    try {
      const original = stringValue(suggestion);
      const draft = original === null ? undefined : (draftValues[suggestion.id] ?? original);
      const response = await fetch("/api/v1/contributions/identity-review", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: candidate.id,
          revision: review.revision,
          suggestionId: suggestion.id,
          ...(draft !== undefined && draft !== original ? { value: draft } : {}),
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "표기 정비 제안을 승인하지 못했습니다"));
      const body = await response.json() as {
        revision?: number;
        review?: IdentityReview | null;
        candidate?: IdentityReviewCandidate;
      };
      const nextReview = body.review ?? null;
      setReviews((items) => ({ ...items, [candidate.id]: nextReview }));
      setCandidates((items) => items.flatMap((item) => {
        if (item.id !== candidate.id) return [item];
        const nextCandidate = {
          ...item,
          ...body.candidate,
          revision: body.revision ?? item.revision + 1,
        };
        return nextReview && nextReview.suggestions.length === 0 ? [] : [nextCandidate];
      }));
      setMessage({ kind: "ok", text: `‘${candidate.name}’의 ${FIELD_LABEL[suggestion.field]} 제안을 승인해 저장했습니다.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : "표기 정비 제안을 승인하지 못했습니다.";
      setErrors((items) => ({ ...items, [candidate.id]: text }));
      setMessage({ kind: "bad", text });
    } finally {
      setSavingIds((items) => items.filter((id) => id !== suggestion.id));
    }
  }

  async function reject(candidate: IdentityReviewCandidate, suggestion: IdentityReviewSuggestion): Promise<void> {
    const review = reviews[candidate.id];
    if (!review || isSaving(suggestion.id) || isGenerating(candidate.id)) return;
    setSavingIds((items) => items.includes(suggestion.id) ? items : [...items, suggestion.id]);
    try {
      const response = await fetch("/api/v1/contributions/identity-review", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: candidate.id, revision: review.revision, suggestionId: suggestion.id }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "표기 정비 제안을 거절하지 못했습니다"));
      const nextReview = { ...review, suggestions: review.suggestions.filter((item) => item.id !== suggestion.id) };
      setReviews((items) => ({
        ...items,
        [candidate.id]: nextReview,
      }));
      if (nextReview.suggestions.length === 0) {
        setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      }
      setMessage({ kind: "ok", text: `‘${candidate.name}’의 제안을 이번 검토에서 제외했습니다.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : "표기 정비 제안을 거절하지 못했습니다.";
      setErrors((items) => ({ ...items, [candidate.id]: text }));
      setMessage({ kind: "bad", text });
    } finally {
      setSavingIds((items) => items.filter((id) => id !== suggestion.id));
    }
  }

  return (
    <section aria-labelledby="identity-review-title" className="space-y-4">
      <div className="card border-brand/25 bg-brand-soft/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-brand">AI 표기 정비 작업대</p>
            <h3 id="identity-review-title" className="mt-1 text-base font-semibold text-ink">현재 표기를 기준에 맞게 정리하세요</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-2">규칙으로 확실히 찾을 수 있는 문제와 도메인 문맥으로 보완할 수 있는 항목만 보여줍니다. AI 제안은 자동 저장되지 않으며, 승인한 값만 용어에 반영됩니다.</p>
          </div>
          <details className="max-w-full shrink-0 text-xs text-ink-2">
            <summary className="cursor-pointer rounded-md px-2 py-1 font-medium text-brand hover:bg-panel/60">정비 기준 보기</summary>
            <ul className="mt-2 max-w-md list-disc space-y-1 rounded-lg border border-line/70 bg-panel/70 p-3 pl-6 leading-5">
              <li>약어와 영문 확장명의 글자 대응은 규칙으로 판정하지 않습니다.</li>
              <li>영문·국문 확장명은 선택 필드이며, 근거가 있을 때만 제안합니다.</li>
              <li>보류는 이 화면에 남고, 오탐 숨김은 같은 생성기 버전에서 다시 표시하지 않습니다.</li>
            </ul>
          </details>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ["현재 페이지", candidates.length],
          ["규칙 확인", candidates.filter((candidate) => candidate.issues.length > 0).length],
          ["문맥 보완", candidates.filter((candidate) => candidate.issues.length === 0).length],
          ["AI 검토 대기", pendingCandidates.length],
        ] as const).map(([label, value]) => (
          <div key={label} className="card px-3 py-2.5">
            <p className="text-[11px] text-ink-3">{label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{value.toLocaleString("ko-KR")}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action="/contribute/fields" className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <input type="hidden" name="field" value="identity" />
          <label className="min-w-[14rem] flex-1 text-xs text-ink-2">용어 필터
            <input name="q" defaultValue={query} autoComplete="off" placeholder="대표명·확장명·URL에 포함된 단어…" className="field mt-1 p-2 text-sm" />
          </label>
          <label className="text-xs text-ink-2">대상
            <select name="view" defaultValue={view} className="field mt-1 min-w-[10rem] p-2 text-sm">
              {(Object.keys(VIEW_LABEL) as IdentityReviewView[]).map((option) => <option key={option} value={option}>{VIEW_LABEL[option]}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-primary btn-sm">필터</button>
          {(query || view !== "all") && <Link href="/contribute/fields?field=identity" className="btn-quiet btn-sm">초기화</Link>}
        </form>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="text-xs text-ink-3">{VIEW_LABEL[view]} · {visibleCandidates.length.toLocaleString("ko-KR")}개 표시</p>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!aiAvailable || autoProgress.active || pendingCandidates.length === 0}
            title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : pendingCandidates.length === 0 ? "AI 검토 대기 중인 용어가 없습니다." : undefined}
            onClick={() => void generateVisibleCandidates()}
          >
            {autoProgress.active ? `AI 검토 중 ${autoProgress.completed}/${autoProgress.total}` : `AI 검토 시작 (${pendingCandidates.length})`}
          </button>
        </div>
      </div>

      {!aiAvailable && <p role="status" aria-live="polite" className="rounded-lg border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-xs text-ink-2">AI 연결이 꺼져 있어 새 제안을 만들 수 없습니다. 기존 제안은 계속 승인·보류·숨김 처리할 수 있고, 직접 편집으로 표기를 정비할 수도 있습니다.</p>}
      {autoProgress.active && <p role="status" aria-live="polite" className="text-xs text-brand">현재 페이지의 AI 제안을 준비하고 있습니다. 이 화면을 닫아도 이미 완료된 검토는 저장됩니다.</p>}

      <div className="space-y-3">
        {candidates.length === 0 ? (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">검토·보완할 표기 대상이 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">검색어를 바꾸거나 다음 페이지를 확인해 보세요.</p>
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">이 조건에 맞는 표기 대상이 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">대상 필터를 ‘전체 대상’으로 바꾸거나 다른 조건을 선택해 보세요.</p>
          </div>
        ) : visibleCandidates.map((candidate) => {
          const review = reviews[candidate.id];
          const generating = isGenerating(candidate.id);
          const error = errors[candidate.id];
          return (
            <article key={candidate.id} aria-busy={generating} className="card overflow-hidden">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/edit/${candidate.slug}`} className="font-semibold text-ink hover:text-brand">{candidate.name}</Link>
                    <span translate="no" className="font-mono text-[11px] text-ink-3">/{candidate.slug}</span>
                    {candidate.issues.length === 0 && <span className="chip chip-on !py-0.5 !text-[11px]">도메인 문맥 기반 AI 보완</span>}
                  </div>
                  {(candidate.domain.length > 0 || candidate.categories.length > 0) && (
                    <p className="mt-1 break-words text-[11px] text-ink-3">
                      {[candidate.domain.length > 0 ? `도메인: ${candidate.domain.join(" · ")}` : "", candidate.categories.length > 0 ? `업무: ${candidate.categories.join(" · ")}` : ""].filter(Boolean).join("  ·  ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidate.issues.map((issue) => <span key={issue.id} className={cx("chip max-w-full whitespace-normal break-words !py-0.5 !text-[11px]", issue.severity === "warning" && "border-warn/35 bg-warn-soft text-warn")}>{issue.message}</span>)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/edit/${candidate.slug}`} className="btn-quiet btn-sm">직접 편집</Link>
                  <button type="button" className="btn-primary btn-sm" disabled={!aiAvailable || generating} onClick={() => void generate(candidate, true, true)}>
                    {generating ? "검토 중…" : review ? "다시 검토" : aiAvailable ? "AI 검토" : "AI 연결 필요"}
                  </button>
                </div>
              </header>

              <div className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1.35fr]">
                <section aria-label="현재 표기" className="rounded-lg bg-panel-2/65 p-3">
                  <h3 className="text-xs font-semibold text-ink-2">현재 값</h3>
                  <dl className="mt-2 space-y-2 text-xs">
                    {(["nameEn", "nameKo", "fullNameEn", "fullNameKo"] as const).map((field) => (
                      <div key={field} className="grid grid-cols-[7rem_1fr] gap-2">
                        <dt className="text-ink-3">{FIELD_LABEL[field]}</dt>
                        <dd translate="no" className="break-words text-ink">{currentText(candidate, field)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 border-t border-line/70 pt-2">
                    <p className="text-[11px] text-ink-3">추가 표기</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {candidate.surfaces.length > 0 ? candidate.surfaces.map((surface) => <span key={`${surface.id}-${surface.text}`} translate="no" className="chip !py-0.5 !text-[11px]">{surface.text} · {SURFACE_KIND_LABEL[surface.kind]}</span>) : <span className="text-xs text-ink-3">없음</span>}
                    </div>
                  </div>
                </section>

                <section aria-label="AI 표기 정비 제안" className="min-w-0">
                  {!review && <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-ink-3">AI 검토를 실행하면 현재 표기와 용어집 근거를 비교한 제안이 여기에 표시됩니다.</p>}
                  {review && (
                    <div className="space-y-2">
                      {review.findings.length > 0 && (
                        <div className="rounded-lg border border-line bg-panel-2/70 px-3 py-2.5 text-xs text-ink-2">
                          <p className="font-semibold text-ink">AI 확인 내용</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">{review.findings.map((finding) => <li key={finding.id} className="break-words">{finding.message}</li>)}</ul>
                        </div>
                      )}
                      {sourceLinks(review.sources)}
                      {review.suggestions.length > 0 ? review.suggestions.map((suggestion) => {
                        const isString = typeof suggestion.value === "string";
                        const draft = isString ? (draftValues[suggestion.id] ?? suggestion.value as string) : null;
                        return (
                          <article key={suggestion.id} className="rounded-lg border border-line bg-panel p-3">
                            <div className="flex flex-wrap items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="chip chip-on !py-0.5 !text-[11px]">{FIELD_LABEL[suggestion.field]}</span>
                                  <span className="text-[11px] text-ink-3">{ACTION_LABEL[suggestion.action]} · {Math.round(suggestion.confidence * 100)}%</span>
                                  {review.deferredSuggestionIds?.includes(suggestion.id) && <span className="chip !border-warn/30 !bg-warn-soft !py-0.5 !text-[11px] !text-warn">보류됨</span>}
                                </div>
                                <p className="mt-1 text-[11px] text-ink-3">현재: {currentText(candidate, suggestion.field)}</p>
                                {isString ? (
                                  <input
                                    value={draft ?? ""}
                                    maxLength={500}
                                    disabled={isSaving(suggestion.id)}
                                    onChange={(event) => {
                                      const value = event.currentTarget.value;
                                      setDraftValues((items) => ({ ...items, [suggestion.id]: value }));
                                    }}
                                    className="field mt-1 w-full text-sm"
                                    aria-label={`${FIELD_LABEL[suggestion.field]} 제안`}
                                  />
                                ) : (
                                  <p className="mt-1 break-words text-sm font-medium text-ink">{valueText(suggestion.value)}</p>
                                )}
                                <p className="mt-1.5 break-words text-xs leading-5 text-ink-2">{suggestion.reason}</p>
                                {sourceLinks(suggestion.sources)}
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                <button type="button" className="btn-quiet btn-sm" disabled={isSaving(suggestion.id)} onClick={() => void reject(candidate, suggestion)}>거절</button>
                                <button type="button" className="btn-primary btn-sm" disabled={isSaving(suggestion.id) || (isString && !draft?.trim())} onClick={() => void approve(candidate, suggestion)}>
                                  {isSaving(suggestion.id) ? "저장 중…" : suggestion.action === "remove" ? "삭제 승인" : "승인"}
                                </button>
                              </div>
                            </div>
                            <SuggestionDispositionActions
                              termId={candidate.id}
                              revision={review.revision}
                              feature="identity"
                              suggestionId={suggestion.id}
                              generatorVersion={AI_SUGGESTION_GENERATOR_VERSIONS.identity}
                              payload={{ title: FIELD_LABEL[suggestion.field], field: suggestion.field, value: valueText(suggestion.value), reason: suggestion.reason }}
                              disabled={isSaving(suggestion.id) || generating}
                              onApplied={(disposition) => {
                                setReviews((items) => {
                                  const currentReview = items[candidate.id];
                                  if (!currentReview) return items;
                                  if (disposition === "deferred") {
                                    const deferred = currentReview.deferredSuggestionIds ?? [];
                                    return { ...items, [candidate.id]: { ...currentReview, deferredSuggestionIds: deferred.includes(suggestion.id) ? deferred : [...deferred, suggestion.id] } };
                                  }
                                  return { ...items, [candidate.id]: { ...currentReview, suggestions: currentReview.suggestions.filter((item) => item.id !== suggestion.id) } };
                                });
                                if (disposition !== "deferred" && !review.suggestions.some((item) => item.id !== suggestion.id)) {
                                  setCandidates((items) => items.filter((item) => item.id !== candidate.id));
                                }
                                setMessage({ kind: "ok", text: disposition === "dismissed" ? "오탐으로 숨겼습니다. 같은 생성기 버전에서는 다시 표시하지 않습니다." : disposition === "saved" ? "내 작업에 저장했습니다." : "보류로 기록했습니다." });
                              }}
                            />
                          </article>
                        );
                      }) : <p className="rounded-lg bg-panel-2 px-3 py-4 text-xs text-ink-3">AI가 현재 자료만으로 확정할 수 있는 표기 변경을 찾지 못했습니다.</p>}
                      {review.uncertainties.length > 0 && (
                        <div className="rounded-lg border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-xs text-ink-2">
                          <p className="font-semibold text-warn">확인 필요</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">{review.uncertainties.map((item) => <li key={item} className="break-words">{item}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}
                  {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
                </section>
              </div>
            </article>
          );
        })}
      </div>
      {(page > 1 || hasNextPage) && (
        <nav aria-label="표기 정비 페이지" className="flex items-center justify-center gap-3 border-t border-line pt-4 text-xs">
          {page > 1 ? <Link href={identityPageHref(query, view, page - 1)} className="btn-quiet btn-sm">이전 40개</Link> : <span className="w-[4.5rem]" aria-hidden />}
          <span aria-current="page" className="font-medium text-ink-2">페이지 {page}</span>
          {hasNextPage ? <Link href={identityPageHref(query, view, page + 1)} className="btn-quiet btn-sm">다음 40개</Link> : <span className="w-[4.5rem]" aria-hidden />}
        </nav>
      )}
      {message && <p role={message.kind === "bad" ? "alert" : "status"} aria-live="polite" className={cx("break-words border border-line bg-panel px-3 py-2.5 text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
    </section>
  );
}
