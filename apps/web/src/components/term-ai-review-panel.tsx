"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { HelpTip } from "@/components/help-tip";
import type { EditReviewField, EditReviewResult, EditReviewSource } from "@/lib/ai/edit-review-values";
import type { TermWritePayload } from "@/lib/terms/form-payload";
import { cx } from "@/lib/ui/format";

const FIELD_LABEL: Record<EditReviewField, string> = {
  nameEn: "대표 영문 이름",
  nameKo: "대표 국문 이름",
  fullNameEn: "영문 전체 이름",
  fullNameKo: "국문 전체 이름",
  definitionMd: "한줄 정의",
  bodyMd: "상세 설명",
  domain: "도메인",
  category: "업무 분류",
  topic: "주제",
};

const FINDING_LABEL: Record<EditReviewResult["findings"][number]["kind"], string> = {
  typo: "오타",
  contradiction: "모순",
  consistency: "일관성",
  missing: "내용 보완",
};

const RELATION_LABEL: Record<EditReviewResult["relations"][number]["relationType"], string> = {
  related_to: "관련",
  is_a: "상위 개념",
  part_of: "구성 요소",
  used_in: "사용됨",
  prerequisite_of: "선행 개념",
  replaces: "대체",
};

function SourceLinks({ sources }: { sources: EditReviewSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
      <span>근거</span>
      {sources.map((source) => (
        <Link key={source.slug} href={`/w/${source.slug}`} target="_blank" rel="noreferrer" className="rounded bg-panel-2 px-1.5 py-0.5 hover:text-brand">
          {source.title}
        </Link>
      ))}
    </div>
  );
}

export function TermAiReviewPanel({
  termSlug,
  payload,
  disabled,
  onApply,
}: {
  termSlug: string;
  payload: TermWritePayload;
  disabled: boolean;
  onApply: (field: EditReviewField, value: string | string[]) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [instruction, setInstruction] = useState("");
  const [review, setReview] = useState<EditReviewResult | null>(null);
  const [reviewedSignature, setReviewedSignature] = useState<string | null>(null);
  const [reviewedWithGuide, setReviewedWithGuide] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSignature = useMemo(() => JSON.stringify({
    payload,
    instruction: instruction.trim(),
  }), [payload, instruction]);
  const stale = reviewedSignature !== null && reviewedSignature !== requestSignature;
  const resultCount = review ? review.findings.length + review.suggestions.length + review.relations.length : 0;
  const needsDraft = !payload.definitionMd && !payload.bodyMd;

  async function requestReview() {
    if (disabled || loading) return;
    setLoading(true);
    setError(null);
    setApplied(new Set());
    try {
      const response = await fetch(`/api/v1/terms/${encodeURIComponent(termSlug)}/ai-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          term: payload,
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        }),
      });
      const body = await response.json().catch(() => null) as {
        review?: EditReviewResult;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.review) {
        setError(body?.error?.message ?? "AI 검토를 완료하지 못했습니다.");
        return;
      }
      setReview(body.review);
      setReviewedSignature(requestSignature);
      setReviewedWithGuide(Boolean(instruction.trim()));
      detailsRef.current!.open = true;
    } catch {
      setError("네트워크 오류로 AI 검토를 완료하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details ref={detailsRef} className="group/details card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-soft text-xs text-brand" aria-hidden="true">✦</span>
        <span className="text-sm font-semibold text-ink">AI 검토</span>
        <span className="min-w-0 truncate text-xs text-ink-3">
          {loading ? "검토 중…" : review ? `${resultCount}개 검토 결과` : needsDraft ? "정의·설명 초안 작성" : "문장·모순·관계 확인"}
        </span>
        <span className="ml-auto text-xs text-ink-3 transition-transform group-open/details:rotate-180" aria-hidden="true">⌄</span>
      </summary>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor="ai-review-instruction" className="text-xs font-medium text-ink-2">검토 가이드 <span className="font-normal text-ink-3">(선택)</span></label>
          <HelpTip text="비워두면 전체 항목을 자동으로 검토합니다. 입력하면 기본 검토에 원하는 관점을 추가하며, 가이드 자체도 용어집 근거와 대조합니다." />
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <textarea
              id="ai-review-instruction"
              name="aiReviewInstruction"
              autoComplete="off"
              value={instruction}
              maxLength={1_000}
              rows={1}
              disabled={disabled || loading}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="예: MTO의 원문과 정의를 엄격히 확인…"
              className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-ink-3/70 focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
              aria-describedby="ai-review-instruction-count"
            />
            <p id="ai-review-instruction-count" className="mt-0.5 text-right text-[11px] tabular-nums text-ink-3">{instruction.length.toLocaleString("ko-KR")}/1,000</p>
          </div>
          <button type="button" disabled={disabled || loading} onClick={() => void requestReview()} className="btn-primary shrink-0">
            {loading ? "검토 중…" : "검토 시작"}
          </button>
        </div>

        {stale && (
          <div className="note note-warn mt-3 flex flex-wrap items-center justify-between gap-2" role="status">
            <span>검토 후 입력이 변경되었습니다. 일부 결과가 현재 내용과 다를 수 있습니다.</span>
            <button type="button" disabled={disabled || loading} onClick={() => void requestReview()} className="btn-ghost btn-sm">다시 검토</button>
          </div>
        )}
        {error && <div className="note note-danger mt-3" role="alert">{error}</div>}

        {review && (
          <div className="mt-3 space-y-4" aria-live="polite">
            <div className="rounded-lg bg-panel-2 px-3 py-2 text-sm leading-6 text-ink">
              <span className="mr-2 text-[11px] font-medium text-brand">{reviewedWithGuide ? "가이드 포함" : "자동 검토"}</span>
              {review.summary}
            </div>

            {review.findings.length > 0 && (
              <section aria-labelledby="ai-findings-heading">
                <h3 id="ai-findings-heading" className="mb-2 text-xs font-semibold text-ink-2">확인할 점</h3>
                <div className="grid gap-2 lg:grid-cols-2">
                  {review.findings.map((finding) => (
                    <article key={finding.id} className={cx("rounded-lg border p-3", finding.severity === "warning" ? "border-warn/35 bg-warn-soft/50" : "border-line bg-panel") }>
                      <div className="flex items-center gap-2">
                        <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium", finding.severity === "warning" ? "bg-warn/15 text-warn" : "bg-info-soft text-info")}>{FINDING_LABEL[finding.kind]}</span>
                        <h4 className="text-sm font-medium text-ink">{finding.title}</h4>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-ink-2">{finding.description}</p>
                      <SourceLinks sources={finding.sources} />
                    </article>
                  ))}
                </div>
              </section>
            )}

            {review.suggestions.length > 0 && (
              <section aria-labelledby="ai-suggestions-heading">
                <h3 id="ai-suggestions-heading" className="mb-2 text-xs font-semibold text-ink-2">바로 반영할 수 있는 제안</h3>
                <div className="space-y-2">
                  {review.suggestions.map((suggestion) => {
                    const isApplied = applied.has(suggestion.id);
                    const value = Array.isArray(suggestion.value) ? suggestion.value.join(", ") : suggestion.value;
                    return (
                      <article key={suggestion.id} className="rounded-lg border border-line bg-panel p-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-brand">{FIELD_LABEL[suggestion.field]}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{value}</p>
                            <p className="mt-1 text-xs leading-5 text-ink-3">{suggestion.reason}</p>
                            <SourceLinks sources={suggestion.sources} />
                          </div>
                          <button
                            type="button"
                            disabled={disabled || isApplied}
                            onClick={() => {
                              onApply(suggestion.field, suggestion.value);
                              setApplied((current) => new Set(current).add(suggestion.id));
                            }}
                            className="btn-ghost btn-sm"
                          >
                            {isApplied ? "반영됨" : "반영"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {review.relations.length > 0 && (
              <section aria-labelledby="ai-relations-heading">
                <div className="mb-2 flex items-center gap-1.5">
                  <h3 id="ai-relations-heading" className="text-xs font-semibold text-ink-2">관계 후보</h3>
                  <HelpTip text="AI가 찾은 참고 후보입니다. 이 화면에서는 관계를 자동 등록하지 않습니다." />
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {review.relations.map((relation) => (
                    <Link key={relation.id} href={`/w/${relation.targetSlug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-panel px-3 py-2.5 text-xs hover:border-brand/40">
                      <span className="font-medium text-ink">{relation.targetName}</span>
                      <span className="ml-2 text-ink-3">{RELATION_LABEL[relation.relationType]} · {relation.confidence}%</span>
                      <span className="mt-1 block leading-5 text-ink-3">{relation.reason}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {resultCount === 0 && <p className="py-2 text-center text-xs text-ink-3">지금 바로 고칠 만한 문제나 제안을 찾지 못했습니다.</p>}
          </div>
        )}
      </div>
    </details>
  );
}
