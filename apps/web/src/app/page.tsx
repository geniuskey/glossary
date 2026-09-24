import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { AppShell } from "@/components/app-shell";
import { ConceptConvergence } from "@/components/concept-convergence";
import { InfoFooter } from "@/components/info-links";
import { SearchBox } from "@/components/search-box";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { needsSetup } from "@/lib/auth/setup";
import { initialAdminEmail, isInitialAdminEmail, ssoLoginUrl } from "@/lib/auth/policy";
import { loadSsoConfig, resolveLoginSsoMode, resolvePasswordLoginEnabled } from "@/lib/auth/sso/config";
import { inspectProxyHeaders } from "@/lib/auth/sso/proxy-headers";
import { SURFACE_KIND_LABEL, TERM_STATUS_LABEL } from "@/lib/terms/enums";
import { getTermByIdOrSlug, listTerms, termFacets, type TermDetail, type TermFacets } from "@/lib/terms/query";
import { searchTerms, type SearchHit } from "@/lib/terms/search";
import { newTermHref, termHref } from "@/lib/terms/search-ui";
import { cx, displayName } from "@/lib/ui/format";
import { getHomeContent } from "@/lib/workspace/home-content";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "@/lib/workspace/home-content-values";
import { getWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";
import type { WorkspaceHomeMode } from "@glossary/db";

export const dynamic = "force-dynamic";
const RESULT_LIMIT = 20;

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const user = await getCurrentUser();
  if (!user) {
    const setupNeeded = await needsSetup();
    const sso = await loadSsoConfig();
    const passwordEnabled = resolvePasswordLoginEnabled(sso);
    const ssoMode = resolveLoginSsoMode(sso, setupNeeded);
    const ssoHref = ssoLoginUrl(ssoMode);
    if (setupNeeded) {
      if (initialAdminEmail() && ssoHref && !passwordEnabled) {
        const proxyIdentity = ssoMode === "oauth2-proxy"
          ? inspectProxyHeaders(await headers()).identity
          : null;
        if (proxyIdentity) redirect(isInitialAdminEmail(proxyIdentity.email)
          ? "/login?config=sso-access-denied"
          : "/login?config=initial-admin-required");
        redirect(ssoHref);
      }
      redirect("/setup");
    }
    if (!passwordEnabled && ssoHref) redirect(ssoHref);
    redirect("/login");
  }

  const raw = await searchParams;
  const rawQ = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  const q = (rawQ ?? "").trim();
  const [hits, facets, homeContent, recentTerms, workspaceSettings, aiConfig] = await Promise.all([
    q ? searchTerms(q, RESULT_LIMIT) : Promise.resolve<SearchHit[]>([]),
    termFacets(),
    q ? Promise.resolve(DEFAULT_HOME_CONTENT) : getHomeContent(),
    q ? Promise.resolve([]) : listTerms({ page: 1, pageSize: 3, sort: "updatedAt", dir: "desc" })
      .then(({ items }) => Promise.all(items.map((term) => getTermByIdOrSlug(term.id))))
      .then((items) => items.filter((term): term is TermDetail => term !== null)),
    getWorkspaceMenuSettings(),
    loadAiConfig().then(publicAiConfig),
  ]);

  return (
    <AppShell user={user} title={q ? "용어 검색" : "홈"} search={false} roomy>
      {q ? (
        <div className="mx-auto w-full max-w-3xl pt-2 sm:pt-6">
          <div className="animate-fade-up">
            <p className="text-sm font-semibold text-accent">용어 검색</p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-ink sm:text-4xl">
              <span className="text-brand">“{q}”</span>를 찾아봤어요
            </h1>
            <p className="mt-3 text-sm text-ink-2">약어와 별칭, 비슷한 표기까지 함께 확인합니다.</p>
            <div className="mt-6">
              <SearchBox key={q} defaultValue={q} />
            </div>
          </div>
          <Results q={q} hits={hits} />
        </div>
      ) : <HomeLanding
        facets={facets}
        homeContent={homeContent}
        recentTerms={recentTerms}
        homeMode={workspaceSettings.homeMode}
        aiAvailable={aiConfig.enabled && aiConfig.secretsReadable}
      />}
      <InfoFooter className="mt-16 border-t border-line pt-6" />
    </AppShell>
  );
}

function HomeLanding({ facets, homeContent, recentTerms, homeMode, aiAvailable }: { facets: TermFacets; homeContent: HomeContent; recentTerms: TermDetail[]; homeMode: WorkspaceHomeMode; aiAvailable: boolean }) {
  const active = facets.statuses.find((status) => status.value === "active")?.count ?? 0;
  const domains = facets.domains.slice(0, 8);
  const visibleMode = homeMode === "chat" && aiAvailable ? "chat" : "search";
  return (
    <>
      <section className="grid items-center gap-12 border-b border-line pb-12 pt-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:pb-16 lg:pt-8">
        <div className="min-w-0 animate-fade-up">
          <p className="text-sm font-semibold text-accent">{homeContent.eyebrow}</p>
          <h1 className="mt-3 text-[clamp(2rem,4.2vw,3.25rem)] font-bold leading-[1.2] tracking-[-0.035em] text-ink"><HomeTitle title={homeContent.title} /></h1>
          <p className="mt-5 max-w-xl whitespace-pre-line text-[15px] leading-7 text-ink-2">{homeContent.description}</p>
          <div className="mt-8 max-w-xl">
            {visibleMode === "chat" ? <HomeChatPrompt /> : <SearchBox defaultValue="" />}
          </div>
          <p className="mt-3 text-xs text-ink-3">{visibleMode === "chat" ? "용어집에 근거해 답하고, 필요한 경우 정리 작업으로 이어집니다." : "약어, 별칭, 금지 표기까지 한 번에 찾아보세요."}</p>
        </div>
        <ConceptConvergence />
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        <div className="min-w-0 space-y-12">
          <section aria-labelledby="recent-terms-heading">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="recent-terms-heading" className="text-lg font-bold tracking-tight text-ink">최근 다듬은 용어</h2>
              <Link href="/sheet?sort=updatedAt&dir=desc" className="btn-quiet btn-sm">전체 용어 <IconArrow /></Link>
            </div>
            {recentTerms.length > 0 ? <div className="grid gap-3 md:grid-cols-3">
              {recentTerms.map((term) => <Link key={term.id} href={`/g/${term.slug}`} className="dictionary-card group flex min-w-0 flex-col p-5">
                <p className="text-[11px] text-ink-3">{term.domain.join(" · ") || "용어집"}</p>
                <h3 className="mt-2 break-words text-lg font-bold tracking-tight text-ink group-hover:text-brand">{displayName(term)}</h3>
                {term.nameEn && term.nameKo && <p className="mt-0.5 text-sm text-ink-2">{term.nameKo}</p>}
                <p className="mb-4 mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{term.definitionMd || "아직 한줄 정의가 없습니다. 알고 있는 뜻을 보태 주세요."}</p>
                <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
                  {term.surfaces.filter((surface) => surface.kind === "abbreviation" || surface.kind === "alias").slice(0, 3).map((surface) => <span key={surface.id} className="rounded-md bg-panel-2 px-2 py-0.5 text-xs text-ink-2">{surface.text}<span className="ml-1 text-ink-3">{SURFACE_KIND_LABEL[surface.kind]}</span></span>)}
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand">뜻 보기 <IconArrow /></span>
                </div>
              </Link>)}
            </div> : <div className="card p-6"><h3 className="font-semibold text-ink">아직 등록된 용어가 없습니다</h3><p className="mt-2 text-sm leading-6 text-ink-2">팀에서 자주 묻는 약어 하나부터 시작해 보세요.</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/new" className="btn-primary">첫 용어 등록하기</Link><Link href="/import" className="btn-ghost">엑셀 가져오기</Link></div></div>}
          </section>

          <section aria-labelledby="home-tasks">
            <h2 id="home-tasks" className="text-lg font-bold tracking-tight text-ink">바로 할 수 있는 일</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <TaskLink href="/sheet" icon={<IconSearch />} title="찾아 쓰기" body="뜻과 표기를 확인하고, 필요한 범위의 시트를 공유하세요." />
              <TaskLink href="/contribute" icon={<IconPen />} title="설명 보태기" body="정의와 사용 맥락을 보태세요. 수정 이력이 남아 부담이 없습니다." meta={facets.needsContribution > 0 ? `정리 대기 ${facets.needsContribution.toLocaleString("ko-KR")}개` : undefined} />
              <TaskLink href="/import" icon={<IconImport />} title="기존 용어 모으기" body="엑셀 목록을 미리 검사하고 한 번에 가져오세요." />
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="home-status" className="card p-4">
            <h2 id="home-status" className="px-2 text-sm font-bold text-ink">용어집 현황</h2>
            <ul className="mt-2">
              <Stat value={facets.total} label="등록 용어" href="/sheet" />
              <Stat value={active} label={TERM_STATUS_LABEL.active} href="/sheet?status=active" />
              <Stat value={facets.needsContribution} label="정리 대기" href="/contribute" accent />
            </ul>
            <p className="mt-3 border-t border-line px-2 pt-3 text-[11px] leading-5 text-ink-3">기준 충족은 설정된 작성 요건을 채웠다는 뜻입니다. 내용의 정확성이나 조직의 공식 승인을 보증하지 않습니다.</p>
          </section>
          {domains.length > 0 && <nav aria-labelledby="home-domains" className="card p-4">
            <h2 id="home-domains" className="px-2 text-sm font-bold text-ink">분야별로 찾기</h2>
            <div className="mt-3 flex flex-wrap gap-1.5 px-1">
              {domains.map((domain) => <Link key={domain.value} href={`/sheet?domain=${encodeURIComponent(domain.value)}`} className="chip hover:border-brand/40">{domain.value}<span className="text-ink-3">{domain.count}</span></Link>)}
            </div>
          </nav>}
        </aside>
      </div>
    </>
  );
}

function TaskLink({ href, icon, title, body, meta }: { href: string; icon: ReactNode; title: string; body: string; meta?: string }) {
  return (
    <Link href={href} className="card group flex flex-col p-5 transition-colors hover:border-brand/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">{icon}</span>
      <h3 className="mt-4 flex items-center justify-between gap-2 font-semibold text-ink">{title}<span className="text-ink-3 transition-colors group-hover:text-brand"><IconArrow /></span></h3>
      <p className="mt-1.5 text-sm leading-6 text-ink-2">{body}</p>
      {meta && <p className="mt-3 text-xs font-medium text-accent">{meta}</p>}
    </Link>
  );
}

function HomeChatPrompt() {
  return (
    <form method="get" action="/chat" role="search" aria-label="용어 챗봇 질문" className="w-full">
      <label htmlFor="home-chat-prompt" className="sr-only">용어 챗봇에 질문</label>
      <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-panel p-2 text-left shadow-sm transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <span className="shrink-0 pl-2 text-brand" aria-hidden><IconSearch /></span>
        <input
          id="home-chat-prompt"
          name="prompt"
          type="text"
          maxLength={20_000}
          placeholder="용어집에 무엇이 궁금한가요?"
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <button type="submit" className="btn-primary h-10 shrink-0 px-3 sm:px-4">챗봇 열기</button>
      </div>
    </form>
  );
}

function HomeTitle({ title }: { title: string }) {
  const [first, ...rest] = title.split(/\r?\n/);
  return (
    <>
      {first}
      {rest.map((line, index) => (
        <span key={`${index}:${line}`} className="text-brand">
          <br />{line}
        </span>
      ))}
    </>
  );
}

function Stat({ value, label, href, accent = false }: { value: number; label: string; href: string; accent?: boolean }) {
  return (
    <li>
      <Link href={href} className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-panel-2">
        <span className="text-sm text-ink-2">{label}</span>
        <strong className={cx("text-xl font-bold tabular-nums", accent ? "text-accent" : "text-ink")}>{value.toLocaleString("ko-KR")}</strong>
      </Link>
    </li>
  );
}

function Results({ q, hits }: { q: string; hits: SearchHit[] }) {
  if (hits.length === 0) return (
    <section className="mt-8"><div className="card px-6 py-10 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand"><IconPen /></span><p className="mt-4 text-sm text-ink-2"><span className="font-semibold text-ink">{q}</span>와(과) 맞는 표기가 아직 없습니다.</p><p className="mt-1.5 text-xs text-ink-3">다른 약어나 한국어·영어 이름으로 다시 검색하거나, 전체 목록에서 같은 개념이 있는지 확인해 보세요.</p><div className="mt-5 flex flex-wrap justify-center gap-2"><Link href="/sheet" className="btn-ghost">전체 용어 확인하기</Link><Link href={newTermHref(q)} className="btn-primary">새 용어 등록하기</Link></div></div></section>
  );
  return (
    <section className="card mt-8 p-3 pb-5 sm:p-5">
      <p className="mb-2 px-3 text-xs text-ink-3">결과 <span className="font-medium text-ink-2">{hits.length}</span>개{hits.length === RESULT_LIMIT && " 이상"}<span className="mx-1.5">·</span><Link href={`/sheet?q=${encodeURIComponent(q)}`} className="link">시트에서 보기</Link></p>
      <p className="mb-3 px-3 text-xs leading-6 text-ink-2">금지·비권장 표기로 찾았다면 용어 상세에서 대표 표기와 사용 지침을 확인하세요.</p>
      <ol>{hits.map((hit) => <li key={hit.id}><Link href={termHref(hit)} className="flex gap-3 rounded-lg px-3 py-3 transition hover:bg-panel-2"><span aria-hidden className="mt-1 h-8 w-1 shrink-0 rounded-full bg-brand/60" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-[15px] font-medium text-ink">{displayName(hit)}</span>{hit.nameEn && hit.nameKo && <span className="text-sm text-ink-2">{hit.nameKo}</span>}{hit.matchedKind !== "canonical" && <span className="chip chip-on px-2 py-0.5 text-[11px]">{hit.matchedText}<span className="opacity-70">{SURFACE_KIND_LABEL[hit.matchedKind]}</span></span>}{!hit.exact && <span className="text-[11px] text-ink-3">비슷한 표기</span>}</span>{hit.definitionMd && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2">{hit.definitionMd}</span>}<span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3"><DomainBadges domain={hit.domain} />{hit.status !== "active" && <StatusBadge status={hit.status} />}</span></span></Link></li>)}</ol>
    </section>
  );
}

function IconArrow() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 8h9M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function IconSearch() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="7.5" cy="7.5" r="4.5" /><path d="m11 11 3.5 3.5" strokeLinecap="round" /></svg>; }
function IconPen() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m11.3 3.2 3.5 3.5-8.7 8.7-3.9.4.4-3.9 8.7-8.7Z" strokeLinejoin="round" /><path d="m9.8 4.7 3.5 3.5" /></svg>; }
function IconImport() { return <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M8 1.75v7.5m0 0L5.25 6.5M8 9.25 10.75 6.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.25 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8.5a1.5 1.5 0 0 0 1.5-1.5v-2" strokeLinecap="round" /></svg>; }
