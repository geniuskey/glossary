"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  IdentityAction,
  IdentityField,
  IdentityReview,
  IdentityReviewCandidate,
  IdentityReviewSuggestion,
  IdentitySurfaceValue,
} from "@/lib/ai/identity-review";
import { AI_SUGGESTION_GENERATOR_VERSIONS } from "@/lib/ai/suggestion-disposition-values";
import { cx } from "@/lib/ui/format";
import { SuggestionDispositionActions } from "./suggestion-disposition-actions";

type Message = { kind: "ok" | "bad"; text: string } | null;
type AutoProgress = { active: boolean; total: number; completed: number };

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

function currentText(candidate: IdentityReviewCandidate, field: IdentityField): string {
  if (field === "surface") return candidate.surfaces.map((surface) => `${surface.text} (${SURFACE_KIND_LABEL[surface.kind]})`).join(", ") || "없음";
  return candidate[field] || "없음";
}

function sourceLinks(suggestion: IdentityReviewSuggestion): React.ReactNode {
  if (suggestion.sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
      <span>근거</span>
      {suggestion.sources.map((source) => (
        <Link key={source.slug} href={`/w/${source.slug}`} target="_blank" rel="noreferrer" className="rounded bg-panel-2 px-1.5 py-0.5 hover:text-brand">
          {source.title}
        </Link>
      ))}
    </div>
  );
}

export function IdentityReviewPanel({ initialCandidates, query, aiAvailable }: {
  initialCandidates: IdentityReviewCandidate[];
  query: string;
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
  const handledRef = useRef(new Set<string>());

  function isGenerating(termId: string): boolean {
    return generatingIds.includes(termId);
  }

  function isSaving(suggestionId: string): boolean {
    return savingIds.includes(suggestionId);
  }

  async function generate(candidate: IdentityReviewCandidate, announce = true, force = false, skipHandled = false): Promise<void> {
    if (!aiAvailable || generatingRef.current.has(candidate.id)) return;
    if (skipHandled && handledRef.current.has(candidate.id)) return;
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
      handledRef.current.add(candidate.id);
      generatingRef.current.delete(candidate.id);
      setGeneratingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  useEffect(() => {
    if (!aiAvailable || initialCandidates.length === 0) {
      setAutoProgress({ active: false, total: 0, completed: 0 });
      return;
    }
    let cancelled = false;
    let cursor = 0;
    let completed = 0;
    const pending = initialCandidates;
    const total = pending.length;
    setAutoProgress({ active: true, total, completed: 0 });
    const worker = async () => {
      while (!cancelled) {
        const candidate = pending[cursor];
        cursor += 1;
        if (!candidate) return;
        await generate(candidate, false, false, true);
        completed += 1;
        if (!cancelled) setAutoProgress({ active: true, total, completed });
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker())).then(() => {
      if (!cancelled) setAutoProgress({ active: false, total, completed });
    });
    return () => { cancelled = true; };
  }, [aiAvailable, initialCandidates]);

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
    <section aria-label="AI 표기 정비 목록" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action="/contribute/fields" className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <input type="hidden" name="field" value="identity" />
          <label className="min-w-0 flex-1 text-xs text-ink-2">용어 필터
            <input name="q" defaultValue={query} autoComplete="off" placeholder="대표명·확장명·URL에 포함된 단어…" className="mt-1 block w-full rounded-lg border border-line bg-panel p-2 text-sm text-ink" />
          </label>
          <button type="submit" className="btn-primary btn-sm">필터</button>
          {query && <Link href="/contribute/fields?field=identity" className="btn-quiet btn-sm">초기화</Link>}
        </form>
        <p className="text-xs text-ink-3">검토·보완 대상 {candidates.length.toLocaleString("ko-KR")}개</p>
      </div>

      {autoProgress.active && <p role="status" className="text-xs text-brand">AI 제안 준비 중 {autoProgress.completed}/{autoProgress.total}</p>}

      <div className="space-y-3">
        {candidates.length === 0 ? (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">검토·보완할 표기 대상이 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">규칙상 오류가 있거나 도메인 문맥으로 AI가 채워볼 수 있는 누락 필드가 있는 용어가 없습니다.</p>
          </div>
        ) : candidates.map((candidate) => {
          const review = reviews[candidate.id];
          const generating = isGenerating(candidate.id);
          const error = errors[candidate.id];
          return (
            <article key={candidate.id} className="card overflow-hidden">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/edit/${candidate.slug}`} className="font-semibold text-ink hover:text-brand">{candidate.name}</Link>
                    <span className="font-mono text-[11px] text-ink-3">/{candidate.slug}</span>
                    {candidate.issues.length === 0 && <span className="chip chip-on !py-0.5 !text-[11px]">도메인 문맥 기반 AI 보완</span>}
                  </div>
                  {(candidate.domain.length > 0 || candidate.categories.length > 0) && (
                    <p className="mt-1 text-[11px] text-ink-3">
                      {[candidate.domain.length > 0 ? `도메인: ${candidate.domain.join(" · ")}` : "", candidate.categories.length > 0 ? `업무: ${candidate.categories.join(" · ")}` : ""].filter(Boolean).join("  ·  ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {candidate.issues.map((issue) => <span key={issue.id} className={cx("chip !py-0.5 !text-[11px]", issue.severity === "warning" && "border-warn/35 bg-warn-soft text-warn")}>{issue.message}</span>)}
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
                        <dd className="break-words text-ink">{currentText(candidate, field)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 border-t border-line/70 pt-2">
                    <p className="text-[11px] text-ink-3">추가 표기</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {candidate.surfaces.length > 0 ? candidate.surfaces.map((surface) => <span key={`${surface.id}-${surface.text}`} className="chip !py-0.5 !text-[11px]">{surface.text} · {SURFACE_KIND_LABEL[surface.kind]}</span>) : <span className="text-xs text-ink-3">없음</span>}
                    </div>
                  </div>
                </section>

                <section aria-label="AI 표기 정비 제안" className="min-w-0">
                  {!review && <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-ink-3">AI 검토를 실행하면 현재 표기와 용어집 근거를 비교한 제안이 여기에 표시됩니다.</p>}
                  {review && (
                    <div className="space-y-2">
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
                                    onChange={(event) => setDraftValues((items) => ({ ...items, [suggestion.id]: event.currentTarget.value }))}
                                    className="field mt-1 w-full text-sm"
                                    aria-label={`${FIELD_LABEL[suggestion.field]} 제안`}
                                  />
                                ) : (
                                  <p className="mt-1 break-words text-sm font-medium text-ink">{valueText(suggestion.value)}</p>
                                )}
                                <p className="mt-1.5 text-xs leading-5 text-ink-2">{suggestion.reason}</p>
                                {sourceLinks(suggestion)}
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
                          <ul className="mt-1 list-disc space-y-1 pl-4">{review.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
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
      {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("border border-line bg-panel px-3 py-2.5 text-xs", message.kind === "bad" ? "text-danger" : "text-ok")}>{message.text}</p>}
    </section>
  );
}
