"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PreparedReview } from "@/lib/ai/auto-review";
import type { ContributionTerm } from "@/lib/terms/query";
import { cx, displayName } from "@/lib/ui/format";

function preparedReviewFor(
  term: ContributionTerm,
  reviews: Record<string, PreparedReview>,
): PreparedReview | undefined {
  const review = reviews[term.id];
  return review?.revision === term.revision ? review : undefined;
}

function reviewStatus(
  term: ContributionTerm,
  reviews: Record<string, PreparedReview>,
  autoReviewEnabled: boolean,
): { label: string; className: string } {
  const review = preparedReviewFor(term, reviews);
  if (review) {
    return review.suggestions.length > 0
      ? { label: `${review.suggestions.length}개`, className: "bg-brand-soft text-brand" }
      : { label: "완료", className: "bg-ok-soft text-ok" };
  }
  return autoReviewEnabled
    ? { label: "준비 중", className: "bg-brand-soft text-brand" }
    : { label: "대기", className: "bg-panel-2 text-ink-3" };
}

export function AgentTermList({
  terms,
  reviews,
  selectedTermId,
  totalTerms,
  autoReviewEnabled,
}: {
  terms: ContributionTerm[];
  reviews: Record<string, PreparedReview>;
  selectedTermId: string;
  totalTerms: number;
  autoReviewEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredTerms = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    if (!needle) return terms;
    return terms.filter((term) => [
      term.nameKo,
      term.nameEn,
      term.fullNameKo,
      term.fullNameEn,
      term.slug,
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(needle));
  }, [query, terms]);
  const preparedTermCount = terms.filter((term) => {
    const review = preparedReviewFor(term, reviews);
    return Boolean(review && review.suggestions.length > 0);
  }).length;

  return (
    <aside className="card flex min-h-0 flex-col overflow-hidden lg:sticky lg:top-16">
      <header className="shrink-0 border-b border-line bg-panel-2/55 px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">검토 대상</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              {totalTerms > terms.length ? `총 ${totalTerms.toLocaleString("ko-KR")}개 중 ${terms.length.toLocaleString("ko-KR")}개 표시` : `${totalTerms.toLocaleString("ko-KR")}개 용어`}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand">
            {preparedTermCount.toLocaleString("ko-KR")}개 제안
          </span>
        </div>
        <label className="sr-only" htmlFor="agent-review-term-search">검토 대상 검색</label>
        <input
          id="agent-review-term-search"
          type="search"
          name="reviewTermSearch"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          autoComplete="off"
          placeholder="용어 검색…"
          className="field mt-3 w-full text-sm"
        />
      </header>

      <nav aria-label="제안 검토 대상" className="min-h-0">
        <ul className="max-h-64 overflow-y-auto overscroll-contain p-1.5 lg:max-h-[calc(100dvh-12rem)]">
          {filteredTerms.map((term) => {
            const status = reviewStatus(term, reviews, autoReviewEnabled);
            const selected = term.id === selectedTermId;
            return (
              <li key={term.id}>
                <Link
                  href={`/contribute?tab=agent&termId=${encodeURIComponent(term.id)}`}
                  scroll={false}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`${displayName(term)}, ${status.label}`}
                  className={cx(
                    "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{displayName(term)}</span>
                    {(term.fullNameEn || term.fullNameKo) && (
                      <span className="mt-0.5 block truncate text-[11px] text-ink-3">{term.fullNameEn || term.fullNameKo}</span>
                    )}
                  </span>
                  <span className={cx("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", status.className)}>
                    {status.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {filteredTerms.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-ink-3">검색 결과가 없습니다.</p>
        )}
      </nav>
    </aside>
  );
}
