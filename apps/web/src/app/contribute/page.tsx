import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { scheduleAfterResponse } from "@/lib/after-response";
import { MissingFields } from "@/components/term-completion";
import { CategoryBadges, DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { listPreparedReviews, listReviewQueue, prepareAutoReviews, resumeReviewQueue, reviewQueueStatuses } from "@/lib/ai/auto-review";
import { listBusinessCategories } from "@/lib/terms/categories";
import { listContributionTerms } from "@/lib/terms/query";
import { cx, displayName, relativeTime } from "@/lib/ui/format";
import { AgentReviewPanel } from "./agent-review-panel";
import { ManualReviewButton } from "./manual-review-button";
import { ReviewQueuePanel } from "./review-queue-panel";

export const metadata = { title: "함께 정리" };

const TABS = [
  { key: "edit", label: "정리 대기", href: "/contribute" },
  { key: "agent", label: "제안 검토", href: "/contribute?tab=agent" },
  { key: "queue", label: "AI 검토 큐", href: "/contribute?tab=queue" },
] as const;

export default async function ContributePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const rawTab = params.tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab = requestedTab === "agent" || requestedTab === "queue" ? requestedTab : "edit";
  const rawTermId = params.termId;
  const selectedTermId = tab === "agent" ? (Array.isArray(rawTermId) ? rawTermId[0] : rawTermId) : undefined;
  const [queue, storedAi, reviewQueue] = await Promise.all([
    listContributionTerms(60, user.id, selectedTermId),
    loadAiConfig(),
    listReviewQueue(),
  ]);
  const ai = publicAiConfig(storedAi);
  const categories = tab === "agent" ? await listBusinessCategories() : [];
  const categoryLabels = Object.fromEntries(categories.map((item) => [item.key, item.label]));
  const preparedReviews = tab === "agent" ? await listPreparedReviews(queue.items) : {};
  const queueStatuses = tab === "edit" ? await reviewQueueStatuses(queue.items) : {};
  if (tab === "agent" && ai?.enabled && ai.secretsReadable && ai.autoReviewEnabled) {
    const missing = queue.items.filter((term) => !preparedReviews[term.id]);
    scheduleAfterResponse(() => prepareAutoReviews(missing.map((term) => term.id)));
  }
  if (tab === "queue") {
    scheduleAfterResponse(() => resumeReviewQueue());
  }

  return (
    <AppShell user={user} title="함께 정리" current="contribute">
      <p className="mb-4 text-xl font-semibold tracking-tight text-balance lg:hidden">함께 정리</p>
      <nav className="flex overflow-x-auto overflow-y-hidden border-b border-line" aria-label="함께 정리 방식">
        {TABS.map((item) => (
          <Link key={item.key} href={item.href} aria-current={tab === item.key ? "page" : undefined} className={cx("relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition", tab === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}>
            {item.label}{item.key === "queue" && <span className="ml-1.5 rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{reviewQueue.counts.total}</span>}
          </Link>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-ink-3">
        <p>{tab === "edit" ? "빠진 정보가 많은 용어부터 보여드립니다." : tab === "agent" ? "현재 값과 제안을 비교한 뒤 필요한 변경만 승인하세요." : "자동·수동 AI 검토의 진행 상태를 함께 확인합니다."}</p>
        <span className="font-mono tabular-nums">{tab === "queue" ? `${reviewQueue.counts.active.toLocaleString("ko-KR")}개 처리 중` : `${queue.total.toLocaleString("ko-KR")}개`}</span>
      </div>

      {tab === "edit" ? <>
      <section aria-label="정리를 기다리는 용어">
        {queue.items.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {queue.items.map((term) => (
              <li key={term.id} className="card flex min-w-0 flex-col p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-semibold text-ink">{displayName(term)}</h3>
                    {(term.fullNameEn || term.fullNameKo) && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-3">
                        {[term.fullNameEn, term.fullNameKo].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={term.status} />
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold text-ink-2">{term.completion.complete ? "다음 할 일" : "필요한 정보"}</p>
                  <div>
                    {term.status === "draft" && term.completion.complete ? (
                      <p className="text-xs leading-5 text-brand">
                        핵심 정보가 채워졌습니다. 내용을 확인한 뒤 공개 상태로 바꿔 주세요.
                      </p>
                    ) : (
                      <MissingFields completion={term.completion} />
                    )}
                  </div>
                </div>

                {term.definitionMd && (
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{term.definitionMd}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4 mt-4">
                  <DomainBadges domain={term.domain} />
                  <CategoryBadges categories={term.categories} labels={term.categoryLabels} />
                  <span className="text-xs text-ink-3">최근 수정 {relativeTime(new Date(term.updatedAt))}</span>
                  <div className="ml-auto flex items-start gap-2">
                    <ManualReviewButton termId={term.id} revision={term.revision} initialStatus={queueStatuses[term.id]} aiAvailable={Boolean(ai.enabled && ai.secretsReadable)} />
                    <Link href={`/edit/${term.slug}`} className="btn-primary btn-sm">
                      {term.status === "draft" && term.completion.complete ? "검토하고 공개" : "내용 채우기"}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">정리하거나 공개를 검토할 용어가 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">새 초안을 제안하거나 공개된 설명을 더 알기 쉽게 다듬어 주세요.</p>
            <Link href="/new" className="btn-primary mt-4">새 용어 제안하기</Link>
          </div>
        )}

        {queue.total > queue.items.length && (
          <p className="mt-4 text-center text-xs text-ink-3">
            우선 도움이 필요한 {queue.items.length}개를 보여주고 있습니다.
          </p>
        )}
      </section>
      </> : tab === "agent" ? <AgentReviewPanel initialTerms={queue.items} initialTermId={selectedTermId} autoReviewEnabled={Boolean(ai.enabled && ai.secretsReadable && ai.autoReviewEnabled)} initialReviews={preparedReviews} categoryLabels={categoryLabels} /> : <ReviewQueuePanel queue={reviewQueue} />}
    </AppShell>
  );
}
