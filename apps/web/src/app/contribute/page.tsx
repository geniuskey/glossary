import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { scheduleAfterResponse } from "@/lib/after-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { listPreparedReviews, listReviewQueue, resumeReviewQueue, reviewQueueStatuses } from "@/lib/ai/auto-review";
import { isReviewQueueFilter } from "@/lib/ai/review-queue-types";
import { listBusinessCategories } from "@/lib/terms/categories";
import { listDomains } from "@/lib/terms/domains";
import { listContributionTerms } from "@/lib/terms/query";
import { cx } from "@/lib/ui/format";
import { AgentReviewPanel } from "./agent-review-panel";
import { ContributionQueueTable } from "./contribution-queue-table";
import { QueueRefresh } from "./queue-refresh";
import { ReviewQueuePanel } from "./review-queue-panel";
import { DuplicateReviewPanel } from "@/components/duplicate-review-panel";

export const metadata = { title: "함께 정리" };

const PRIMARY_TABS = [
  { key: "edit", label: "정리 대기", href: "/contribute" },
  { key: "agent", label: "제안 검토", href: "/contribute?tab=agent" },
  { key: "duplicates", label: "중복 후보 검토", href: "/contribute?tab=duplicates" },
] as const;

const AGENT_REVIEW_LIST_LIMIT = 300;

export default async function ContributePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const rawTab = params.tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const legacyField = requestedTab === "definitions" ? "definition" : requestedTab === "domains" ? "domain" : requestedTab === "categories" ? "category" : "";
  if (legacyField) {
    const fieldParams = new URLSearchParams({ field: legacyField });
    const query = scalar("q").slice(0, 200);
    if (query) fieldParams.set("q", query);
    redirect(`/contribute/fields?${fieldParams.toString()}`);
  }
  const tab = requestedTab === "agent" || requestedTab === "queue" || requestedTab === "duplicates" ? requestedTab : "edit";
  const rawTermId = params.termId;
  const selectedTermId = tab === "agent" ? (Array.isArray(rawTermId) ? rawTermId[0] : rawTermId) : undefined;
  const filters = { q: scalar("q").slice(0, 200), category: scalar("category"), missing: scalar("missing"), page: Math.min(100000, Math.max(1, Number.parseInt(scalar("page"), 10) || 1)) };
  const requestedQueueFilter = scalar("status");
  const queueFilter = isReviewQueueFilter(requestedQueueFilter) ? requestedQueueFilter : "all";
  const pageHref = (page: number) => `/contribute?${new URLSearchParams({ q: filters.q, category: filters.category, missing: filters.missing, page: String(page) })}`;
  const contributionLimit = tab === "agent" ? AGENT_REVIEW_LIST_LIMIT : 60;
  const termListTab = tab === "edit" || tab === "agent";
  const [queue, storedAi, reviewQueue] = await Promise.all([
    termListTab
      ? tab === "edit"
        ? listContributionTerms(contributionLimit, user.id, selectedTermId, filters)
        : listContributionTerms(contributionLimit, user.id, selectedTermId, { includePrepared: true, preservePreferredOrder: true })
      : Promise.resolve({ items: [], total: 0 }),
    loadAiConfig(),
    listReviewQueue(tab === "queue" ? { filter: queueFilter, page: filters.page } : { pageSize: 1 }),
  ]);
  const ai = publicAiConfig(storedAi);
  const [categories, domains] = await Promise.all([
    termListTab ? listBusinessCategories() : Promise.resolve([]),
    termListTab ? listDomains() : Promise.resolve([]),
  ]);
  const categoryLabels = Object.fromEntries(categories.map((item) => [item.key, item.label]));
  const preparedReviews = tab === "agent" ? await listPreparedReviews(queue.items) : {};
  const queueStatuses = tab === "edit" ? await reviewQueueStatuses(queue.items) : {};
  if (tab === "queue") {
    scheduleAfterResponse(() => resumeReviewQueue());
  }
  const helpText = tab === "edit"
    ? "보완할 용어를 찾고 직접 편집하거나 AI 검토를 요청합니다."
    : tab === "agent"
      ? "AI와 규칙이 만든 제안을 현재 값과 비교한 뒤 필요한 것만 승인합니다."
      : tab === "duplicates"
        ? "같은 개념으로 보이는 용어 쌍을 비교하고 병합·분리·보류를 결정합니다."
        : tab === "queue"
          ? "AI 요청의 대기·처리·완료·실패 상태를 확인하고 필요한 작업을 다시 요청합니다."
          : "AI 요청의 대기·처리·완료·실패 상태를 확인하고 필요한 작업을 다시 요청합니다.";
  return (
    <AppShell user={user} title="함께 정리" current="contribute" roomy>
      <p className="mb-4 text-xl font-semibold tracking-tight text-balance lg:hidden">함께 정리</p>
      {tab !== "agent" && tab !== "duplicates" && <QueueRefresh active={reviewQueue.counts.active > 0} />}
      <div className="flex min-w-0 items-end gap-2 border-b border-line">
        <nav className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden" aria-label="함께 정리 주요 작업">
          {PRIMARY_TABS.map((item) => (
            <Link key={item.key} href={item.href} aria-current={tab === item.key ? "page" : undefined} className={cx("relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition", tab === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}>
              {item.label}
            </Link>
          ))}
          <Link href="/contribute/fields" className="relative -mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-ink-3 transition hover:text-ink">
            필드 보완
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-1 pb-2.5">
          <Link href="/contribute?tab=queue" aria-current={tab === "queue" ? "page" : undefined} className={cx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-panel-2 hover:text-ink", tab === "queue" ? "bg-brand-soft text-brand" : "text-ink-3")}>
            AI 작업
            {reviewQueue.counts.attention > 0 && <span aria-label={`조치가 필요한 AI 작업 ${reviewQueue.counts.attention}개`} className="rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{reviewQueue.counts.attention}</span>}
          </Link>
          <HelpTip text={helpText} />
        </div>
      </div>

      {tab === "edit" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-ink-3">
          <p>내가 맡은 용어를 먼저, 부족한 정보가 많고 오래 기다린 순으로 보여드립니다.</p>
          <span className="font-mono tabular-nums">{queue.total.toLocaleString("ko-KR")}개</span>
        </div>
      )}

      {tab === "agent" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-ink-3">
          <p>AI와 규칙이 만든 제안을 사람의 판단으로 승인하거나 거절합니다. 용어를 선택하면 필요한 경우 해당 용어의 검토를 준비합니다.</p>
          <span className="font-mono tabular-nums">{queue.total.toLocaleString("ko-KR")}개</span>
        </div>
      )}

      {tab === "queue" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-ink-3">
          <p>AI가 준비한 제안은 제안 검토에서 확인하고, 실패한 작업은 여기서 다시 요청합니다.</p>
          <span className="font-mono tabular-nums">조치 필요 {reviewQueue.counts.attention.toLocaleString("ko-KR")}개 · 진행 중 {reviewQueue.counts.active.toLocaleString("ko-KR")}개</span>
        </div>
      )}

      {tab === "duplicates" ? <DuplicateReviewPanel initialQuery={scalar("term")} initialStatus={scalar("status")} aiAvailable={Boolean(ai.enabled && ai.secretsReadable)} /> : tab === "edit" ? <>
      <form key={`${filters.q}:${filters.category}:${filters.missing}`} action="/contribute" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs text-ink-2">용어 검색<input name="q" defaultValue={filters.q} maxLength={200} autoComplete="off" placeholder="예: 캐시…" className="mt-1 block w-full rounded-lg border border-line bg-panel p-2 text-sm text-ink" /></label>
        <label className="text-xs text-ink-2">업무 분야<select name="category" defaultValue={filters.category} className="mt-1 block max-w-full rounded-lg border border-line bg-panel p-2 text-sm text-ink"><option value="">전체 분야</option>{categories.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className="text-xs text-ink-2">부족한 정보<select name="missing" defaultValue={filters.missing} className="mt-1 block rounded-lg border border-line bg-panel p-2 text-sm text-ink"><option value="">전체 항목</option><option value="meaning">정식 명칭 또는 정의</option><option value="definition">한줄 정의</option><option value="context">도메인 또는 업무 분류</option><option value="body">본문</option></select></label>
        <button type="submit" className="btn-primary btn-sm">찾기</button>
        <Link href="/contribute" className="btn-quiet btn-sm">초기화</Link>
      </form>
      <section aria-label="정리를 기다리는 용어">
        {queue.items.length > 0 ? (
          <ContributionQueueTable
            initialItems={queue.items}
            initialStatuses={queueStatuses}
            aiAvailable={Boolean(ai.enabled && ai.secretsReadable)}
          />
        ) : (
          <div className="card px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">이 목록에 표시할 용어가 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">검색 조건을 바꾸거나 새 용어를 제안해 주세요.</p>
            <Link href="/new" className="btn-primary mt-4">새 용어 제안하기</Link>
          </div>
        )}

        {(queue.total > 60 || filters.page > 1) && <nav aria-label="정리 대기 페이지" className="mt-4 flex items-center justify-center gap-3 text-xs">
          {filters.page > 1 && <Link href={pageHref(filters.page - 1)} className="btn-quiet btn-sm">이전 페이지</Link>}
          <span>{filters.page}페이지 · 총 {queue.total.toLocaleString("ko-KR")}개</span>
          {filters.page * 60 < queue.total && <Link href={pageHref(filters.page + 1)} className="btn-quiet btn-sm">다음 페이지</Link>}
        </nav>}
      </section>
      </> : tab === "agent" ? <AgentReviewPanel key={selectedTermId ?? "default"} initialTerms={queue.items} initialTermId={selectedTermId} totalTerms={queue.total} autoReviewEnabled={Boolean(ai.enabled && ai.secretsReadable && ai.autoReviewEnabled)} initialReviews={preparedReviews} categoryLabels={categoryLabels} /> : <ReviewQueuePanel queue={reviewQueue} aiAvailable={Boolean(ai.enabled && ai.secretsReadable)} />}
    </AppShell>
  );
}
