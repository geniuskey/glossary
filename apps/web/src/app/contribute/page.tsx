import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { scheduleAfterResponse } from "@/lib/after-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { listPreparedReviews, listReviewQueue, prepareAutoReviews, resumeReviewQueue, reviewQueueStatuses } from "@/lib/ai/auto-review";
import { listBusinessCategories } from "@/lib/terms/categories";
import { listContributionTerms } from "@/lib/terms/query";
import { cx } from "@/lib/ui/format";
import { AgentReviewPanel } from "./agent-review-panel";
import { ContributionQueueTable } from "./contribution-queue-table";
import { QueueRefresh } from "./queue-refresh";
import { ReviewQueuePanel } from "./review-queue-panel";
import { DefinitionReviewPanel } from "./definition-review-panel";
import { DuplicateReviewPanel } from "@/components/duplicate-review-panel";
import { listDefinitionReviewCandidates } from "@/lib/ai/definition-review";

export const metadata = { title: "함께 정리" };

const TABS = [
  { key: "edit", label: "정리 대기", href: "/contribute" },
  { key: "agent", label: "제안 검토", href: "/contribute?tab=agent" },
  { key: "duplicates", label: "중복 정리", href: "/contribute?tab=duplicates" },
  { key: "queue", label: "AI 검토 큐", href: "/contribute?tab=queue" },
  { key: "definitions", label: "한줄 정의 정리", href: "/contribute?tab=definitions" },
] as const;

const AGENT_REVIEW_LIST_LIMIT = 300;
const AUTO_REVIEW_PREFETCH_LIMIT = 60;

export default async function ContributePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const rawTab = params.tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab = requestedTab === "agent" || requestedTab === "queue" || requestedTab === "duplicates" || requestedTab === "definitions" ? requestedTab : "edit";
  const rawTermId = params.termId;
  const selectedTermId = tab === "agent" ? (Array.isArray(rawTermId) ? rawTermId[0] : rawTermId) : undefined;
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const filters = { q: scalar("q").slice(0, 200), category: scalar("category"), missing: scalar("missing"), page: Math.min(100000, Math.max(1, Number.parseInt(scalar("page"), 10) || 1)) };
  const pageHref = (page: number) => `/contribute?${new URLSearchParams({ q: filters.q, category: filters.category, missing: filters.missing, page: String(page) })}`;
  const contributionLimit = tab === "agent" ? AGENT_REVIEW_LIST_LIMIT : 60;
  const [queue, storedAi, reviewQueue, definitionCandidates] = await Promise.all([
    tab === "edit" ? listContributionTerms(contributionLimit, user.id, selectedTermId, filters) : listContributionTerms(contributionLimit, user.id, selectedTermId, { includePrepared: tab === "agent", preservePreferredOrder: tab === "agent" }),
    loadAiConfig(),
    listReviewQueue(),
    tab === "definitions" ? listDefinitionReviewCandidates() : Promise.resolve([]),
  ]);
  const ai = publicAiConfig(storedAi);
  const categories = await listBusinessCategories();
  const categoryLabels = Object.fromEntries(categories.map((item) => [item.key, item.label]));
  const preparedReviews = tab === "agent" ? await listPreparedReviews(queue.items) : {};
  const queueStatuses = tab === "edit" ? await reviewQueueStatuses(queue.items) : {};
  if (tab === "agent" && ai?.enabled && ai.secretsReadable && ai.autoReviewEnabled) {
    // 목록은 넓게 보여 주되, 첫 화면 진입만으로 수백 건의 외부 AI 호출을
    // 예약하지 않는다. 나머지 용어는 선택했을 때 GET 라우트가 개별적으로 준비한다.
    const missing = queue.items.slice(0, AUTO_REVIEW_PREFETCH_LIMIT).filter((term) => !preparedReviews[term.id]);
    scheduleAfterResponse(() => prepareAutoReviews(missing.map((term) => term.id)));
  }
  if (tab === "queue") {
    scheduleAfterResponse(() => resumeReviewQueue());
  }

  return (
    <AppShell user={user} title="함께 정리" current="contribute" roomy>
      <p className="mb-4 text-xl font-semibold tracking-tight text-balance lg:hidden">함께 정리</p>
      {tab !== "agent" && tab !== "duplicates" && tab !== "definitions" && <QueueRefresh active={reviewQueue.counts.active > 0} />}
      <div className="flex min-w-0 items-end gap-2 border-b border-line">
        <nav className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden" aria-label="함께 정리 방식">
          {TABS.map((item) => (
            <Link key={item.key} href={item.href} aria-current={tab === item.key ? "page" : undefined} className={cx("relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition", tab === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}>
              {item.label}{item.key === "queue" && <span className="ml-1.5 rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{reviewQueue.counts.total}</span>}
            </Link>
          ))}
        </nav>
        <div className="shrink-0 pb-2.5">
          <HelpTip text="아는 용어 하나부터 함께 정리해 주세요. 용어를 선택해 부족한 정보를 작성하고 저장합니다. AI 제안은 현재 내용과 비교한 뒤 필요한 것만 승인하세요. 좋은 한줄 정의는 무엇인지와 쓰는 목적을 함께 적고, 확인할 근거를 본문에 남기면 좋습니다. 예: 캐시 — 자주 사용하는 데이터를 임시로 저장해 같은 요청을 더 빠르게 처리하는 방법. 저장·승인 후 바로 반영되며 정리 기준 충족 여부는 시스템이 판정합니다." />
        </div>
      </div>

      {tab !== "agent" && tab !== "definitions" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-ink-3">
          <p>{tab === "edit" ? "내가 맡은 용어를 먼저, 부족한 정보가 많고 오래 기다린 순으로 보여드립니다." : "자동·수동 AI 검토의 진행 상태를 함께 확인합니다."}</p>
          <span className="font-mono tabular-nums">{tab === "queue" ? `${reviewQueue.counts.active.toLocaleString("ko-KR")}개 처리 중` : `${queue.total.toLocaleString("ko-KR")}개`}</span>
        </div>
      )}

      {tab === "definitions" ? <DefinitionReviewPanel initialCandidates={definitionCandidates} aiAvailable={Boolean(ai.enabled && ai.secretsReadable)} /> : tab === "duplicates" ? <DuplicateReviewPanel initialQuery={scalar("term")} /> : tab === "edit" ? <>
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
      </> : tab === "agent" ? <AgentReviewPanel key={selectedTermId ?? "default"} initialTerms={queue.items} initialTermId={selectedTermId} totalTerms={queue.total} autoReviewEnabled={Boolean(ai.enabled && ai.secretsReadable && ai.autoReviewEnabled)} initialReviews={preparedReviews} categoryLabels={categoryLabels} /> : <ReviewQueuePanel queue={reviewQueue} />}
    </AppShell>
  );
}
