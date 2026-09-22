import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { loadAiConfig, publicAiConfig } from "@/lib/ai/config";
import { AccountMenu } from "@/components/account-menu";
import { InfoFooter } from "@/components/info-links";
import { BrandMark, getAppNavigation, type NavKey } from "@/components/app-shell";
import { SearchBox } from "@/components/search-box";
import { ScrollReveal } from "@/components/scroll-reveal";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { needsSetup } from "@/lib/auth/setup";
import { initialAdminEmail, isInitialAdminEmail, ssoLoginUrl } from "@/lib/auth/policy";
import { loadSsoConfig, resolveLoginSsoMode, resolvePasswordLoginEnabled } from "@/lib/auth/sso/config";
import { inspectProxyHeaders } from "@/lib/auth/sso/proxy-headers";
import { SURFACE_KIND_LABEL, TERM_STATUS_LABEL } from "@/lib/terms/enums";
import { getTermByIdOrSlug, listTerms, termFacets, type TermDetail, type TermFacets } from "@/lib/terms/query";
import { searchTerms, type SearchHit } from "@/lib/terms/search";
import { newTermHref, termHref } from "@/lib/terms/search-ui";
import { displayName } from "@/lib/ui/format";
import { getHomeContent } from "@/lib/workspace/home-content";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "@/lib/workspace/home-content-values";
import { getWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";
import type { WorkspaceHomeMode } from "@glossary/db";

export const dynamic = "force-dynamic";
const RESULT_LIMIT = 20;
const HOME_NAV_VISIBILITY: Partial<Record<NavKey, string>> = {
  contribute: "hidden md:inline-flex",
  sheet: "hidden sm:inline-flex",
  graph: "hidden lg:inline-flex",
  chat: "hidden lg:inline-flex",
  api: "hidden xl:inline-flex",
  import: "hidden xl:inline-flex",
  statistics: "hidden xl:inline-flex",
};

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
    <div className="relative min-h-screen overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-50 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-on focus:not-sr-only"
      >
        본문으로 건너뛰기
      </a>
      <HomeBackdrop />
      <HomeHeader user={user} />
      {q ? (
        <main id="main-content" tabIndex={-1} className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">용어 검색</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
              <span className="text-brand">“{q}”</span>를 찾아봤어요
            </h1>
            <p className="mt-3 text-sm text-ink-2">약어와 별칭, 비슷한 표기까지 함께 확인합니다.</p>
            <div className="mt-7 rounded-[1.4rem] border border-line/80 bg-panel/80 p-2 shadow-sm backdrop-blur">
              <SearchBox key={q} defaultValue={q} />
            </div>
          </div>
          <Results q={q} hits={hits} />
        </main>
      ) : <HomeLanding
        facets={facets}
        homeContent={homeContent}
        recentTerms={recentTerms}
        homeMode={workspaceSettings.homeMode}
        aiAvailable={aiConfig.enabled && aiConfig.secretsReadable}
      />}
      <InfoFooter className="relative z-10 mx-auto max-w-7xl border-t border-line px-5 py-6 sm:px-8" />
    </div>
  );
}

async function HomeHeader({ user }: { user: CurrentUser }) {
  const navigation = await getAppNavigation(user);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Glossary 홈" aria-current="page">
          <BrandMark />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-ink">Glossary</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">용어집</span>
          </span>
        </Link>
        <nav className="ml-auto flex shrink-0 items-center gap-1" aria-label="주요 메뉴">
          <Link
            href="/sheet"
            className="btn-quiet h-9 w-9 touch-manipulation p-0 sm:hidden"
            aria-label="용어 시트 열기"
            title="용어 시트 열기"
          >
            <IconGrid />
          </Link>
          <details className="relative">
            <summary
              className="btn-quiet h-9 w-9 cursor-pointer list-none touch-manipulation p-0 [&::-webkit-details-marker]:hidden"
              aria-label="전체 메뉴"
              title="전체 메뉴"
            >
              <IconMenu />
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 max-h-[75dvh] w-64 overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-xl shadow-ink/10">
              {navigation.map((group) => <div key={group.label}>
              <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-medium text-ink-3">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-label={`${item.label} · ${item.hint}`}
                      className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45"
                    >
                      <span className="shrink-0 text-ink-3">{item.icon}</span>
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-auto text-[10px] text-ink-3">{item.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              </div>)}
            </div>
          </details>
          {navigation.flatMap((group) => group.items).map((item) => (
            <Link key={item.key} href={item.href} className={`btn-quiet ${HOME_NAV_VISIBILITY[item.key] ?? "hidden"}`}>
              {item.label}
            </Link>
          ))}
          <Link href="/new" className="btn-primary h-9 shrink-0 px-3" aria-label="새 용어 추가">
            <IconPlus /><span className="hidden sm:inline">용어 추가</span>
          </Link>
          <AccountMenu user={user} placement="topbar" />
        </nav>
      </div>
    </header>
  );
}

function HomeLanding({ facets, homeContent, recentTerms, homeMode, aiAvailable }: { facets: TermFacets; homeContent: HomeContent; recentTerms: TermDetail[]; homeMode: WorkspaceHomeMode; aiAvailable: boolean }) {
  const active = facets.statuses.find((status) => status.value === "active")?.count ?? 0;
  const domains = facets.domains.slice(0, 6);
  const visibleMode = homeMode === "chat" && aiAvailable ? "chat" : "search";
  return (
    <main id="main-content" tabIndex={-1} className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
      <section className="relative flex min-h-[calc(100svh-3.5rem)] items-center justify-center border-b border-line py-16 sm:py-20">
        <div className="w-full max-w-3xl animate-fade-up text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand">{homeContent.eyebrow}</p>
          <h1 className="mt-5 text-[clamp(2.35rem,5vw,4rem)] font-semibold leading-[1.15] tracking-[-0.05em] text-ink"><HomeTitle title={homeContent.title} /></h1>
          <div className="mx-auto mt-9 max-w-2xl">
            {visibleMode === "chat" ? <HomeChatPrompt /> : <SearchBox defaultValue="" />}
          </div>
          <p className="mt-4 text-xs text-ink-3">{visibleMode === "chat" ? "용어집에 근거해 답하고, 필요한 경우 정리 작업으로 이어집니다." : "약어, 별칭, 금지 표기까지 한 번에 찾아보세요."}</p>
          <a href="#home-intro" aria-label="용어집 설명으로 이동" className="home-scroll-cue mt-12 inline-flex text-ink-3 transition-colors hover:text-brand">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel/70 text-brand shadow-sm"><IconArrowDown /></span>
          </a>
        </div>
      </section>

      <section id="home-intro" className="scroll-mt-20 pt-20" aria-labelledby="recent-terms-heading">
        <p className="max-w-2xl whitespace-pre-line text-sm leading-7 text-ink-2 sm:text-base">{homeContent.description}</p>
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <div><p className="text-[11px] font-medium tracking-[0.16em] text-ink-3">우리 팀의 사전</p><h2 id="recent-terms-heading" className="mt-1 text-xl font-semibold tracking-tight">최근 다듬은 용어</h2></div>
          <Link href="/sheet?sort=updatedAt&dir=desc" className="btn-quiet btn-sm">전체 용어 <IconArrow /></Link>
        </div>
        {recentTerms.length > 0 ? <div className="grid gap-4 md:grid-cols-3">
          {recentTerms.map((term) => <Link key={term.id} href={`/g/${term.slug}`} className="dictionary-card group flex min-w-0 flex-col p-5 sm:p-6">
            <p className="text-[11px] text-ink-3">{term.domain.join(" · ") || "용어집"}</p>
            <h3 className="mt-3 break-words text-xl font-semibold tracking-tight group-hover:text-brand">{displayName(term)}</h3>
            {term.nameEn && term.nameKo && <p className="mt-1 text-sm text-ink-2">{term.nameKo}</p>}
            <p className="mb-5 mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{term.definitionMd || "아직 한줄 정의가 없습니다. 알고 있는 뜻을 보태 주세요."}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
              {term.surfaces.filter((surface) => surface.kind === "abbreviation" || surface.kind === "alias").slice(0, 3).map((surface) => <span key={surface.id} className="rounded bg-panel-2 px-2 py-1 text-xs text-ink-2">{surface.text}<span className="ml-1 text-ink-3">{SURFACE_KIND_LABEL[surface.kind]}</span></span>)}
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-brand">뜻 살펴보기 <IconArrow /></span>
            </div>
          </Link>)}
        </div> : <div className="card p-6"><h3 className="font-semibold text-ink">아직 등록된 용어가 없습니다</h3><p className="mt-2 text-sm leading-6 text-ink-2">팀에서 자주 묻는 약어 하나부터 시작해 보세요.</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/new" className="btn-primary">첫 용어 등록하기</Link><Link href="/import" className="btn-ghost">엑셀 가져오기</Link></div></div>}
      </section>

      <section className="mt-16 border-y border-line py-5" aria-label="용어집 현황">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-ink-2">
          <Stat value={facets.total} label="개 등록 용어" href="/sheet" />
          <Stat value={active} label={`개 ${TERM_STATUS_LABEL.active}`} href="/sheet?status=active" />
          <Stat value={facets.needsContribution} label="개 정리 대기" href="/contribute" />
        </div>
      </section>

      {domains.length > 0 && <nav aria-label="분야별 용어 탐색" className="mt-8 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs font-medium text-ink-2">분야별로 찾기</span>
        {domains.map((domain) => <Link key={domain.value} href={`/sheet?domain=${encodeURIComponent(domain.value)}`} className="chip bg-panel hover:border-brand/40">{domain.value}<span className="text-ink-3">{domain.count}</span></Link>)}
      </nav>}

      <section className="mb-8 mt-20 scroll-mt-20" aria-labelledby="home-tasks">
        <ScrollReveal>
          <h2 id="home-tasks" className="text-lg font-semibold text-ink">지금 필요한 작업</h2>
        </ScrollReveal>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ScrollReveal delay={80}>
            <TaskLink href="/sheet" title="용어 찾아 쓰기" body="전체 목록에서 뜻과 표기를 확인하고, 필요한 범위의 시트를 공유하세요." />
          </ScrollReveal>
          <ScrollReveal delay={170}>
            <TaskLink href="/contribute" title="부족한 설명 보완하기" body="정리 대기 용어에 정의와 사용 맥락을 보태세요. 수정 이력을 함께 확인할 수 있습니다." />
          </ScrollReveal>
          <ScrollReveal delay={260}>
            <TaskLink href="/import" title="기존 용어 모으기" body="엑셀 목록을 미리 검사하고 가져와 팀의 용어집을 시작하세요." />
          </ScrollReveal>
        </div>
        <ScrollReveal delay={330}>
          <p className="mt-3 text-xs leading-6 text-ink-3">기준 충족은 설정된 작성 요건을 채웠다는 뜻입니다. 내용의 정확성이나 조직의 공식 승인을 보증하지 않습니다.</p>
        </ScrollReveal>
      </section>

      <ScrollReveal>
        <section className="grid items-center gap-10 rounded-[1.75rem] border border-line bg-panel/75 p-6 shadow-[0_24px_80px_-55px_rgb(38_32_99_/_0.28)] backdrop-blur sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <ConceptMap />
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-brand">하나의 개념, 여러 표기</p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-[-0.035em] text-ink sm:text-3xl">
            어떤 표현으로 찾아도<br className="hidden sm:block" /> 같은 의미에 닿도록
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-7 text-ink-2">
            표준 이름과 약어, 한국어 표현, 현장에서 쓰는 별칭을 하나로 연결합니다. 한 번 정리해 두면 누구나 같은 맥락으로 이야기할 수 있습니다.
          </p>
          {domains.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs text-ink-3">많이 다루는 분야</span>
              {domains.map((domain) => <Link key={domain.value} href={`/sheet?domain=${encodeURIComponent(domain.value)}`} className="chip bg-panel">{domain.value}<span className="text-ink-3">{domain.count}</span></Link>)}
            </div>
          )}
        </div>
        </section>
      </ScrollReveal>

      <ScrollReveal delay={100}>
        <section className="mt-8 rounded-[1.75rem] border border-line/80 bg-panel/65 p-6 backdrop-blur sm:p-9">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div><p className="text-xs font-semibold tracking-[0.16em] text-brand">함께 만드는 용어집</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">알고 있는 한 단어가, 모두의 기준이 됩니다.</h2></div>
          <div className="flex flex-wrap gap-2 self-start md:self-auto">
            {facets.needsContribution > 0 && <Link href="/contribute" className="btn-ghost rounded-full px-5 py-2.5">정리 이어가기 <IconArrow /></Link>}
            <Link href="/new" className="btn-primary rounded-full px-5 py-2.5">{facets.total === 0 ? "첫 용어 등록하기" : "새 용어 등록하기"} <IconArrow /></Link>
          </div>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <JourneyCard number="01" title="먼저 찾아보고" body="약어, 별칭, 금지 표기까지 한 번에 검색해요." icon={<IconSearch />} />
          <JourneyCard number="02" title="맥락을 보태고" body="이름과 한줄 정의, 실제로 쓰는 표현을 편하게 적어요." icon={<IconPen />} />
          <JourneyCard number="03" title="함께 다듬어요" body="수정 이력이 남으니 부담 없이 더 좋은 표현을 제안해요." icon={<IconPeople />} />
        </div>
        </section>
      </ScrollReveal>
    </main>
  );
}

function TaskLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="card block p-5 transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
      <h3 className="flex items-center justify-between gap-2 font-semibold text-ink">{title}<IconArrow /></h3>
      <p className="mt-2 text-sm leading-6 text-ink-2">{body}</p>
    </Link>
  );
}

function HomeChatPrompt() {
  return (
    <form method="get" action="/chat" role="search" aria-label="용어 챗봇 질문" className="w-full">
      <label htmlFor="home-chat-prompt" className="sr-only">용어 챗봇에 질문</label>
      <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-panel p-2 text-left shadow-sm transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
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

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const content = <><strong className="text-sm font-semibold tabular-nums text-ink-2">{value.toLocaleString("ko-KR")}</strong><span className="text-xs text-ink-3">{label}</span></>;
  return href
    ? <Link href={href} className="flex items-baseline gap-1.5 rounded-md hover:text-brand">{content}</Link>
    : <span className="flex items-baseline gap-1.5">{content}</span>;
}

function ConceptMap() {
  return (
    <div className="relative mx-auto w-full max-w-[27rem]" aria-label="하나의 개념과 여러 표기가 연결되는 모습">
      <div className="home-concept-glow absolute inset-[16%] rounded-full blur-3xl" />
      <div className="relative rounded-2xl border border-line bg-panel p-5 shadow-[0_20px_60px_-38px_rgb(38_32_99_/_0.4)] sm:p-7">
        <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3"><span className="h-2 w-2 rounded-full bg-ok" />하나의 개념</span><span className="rounded-full bg-panel-2 px-2.5 py-1 text-[10px] font-semibold text-ink-2">설명용 예시</span></div>
        <div className="mt-7"><p className="text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">System on Chip</p><p className="mt-2 text-sm font-medium text-ink-2">시스템 온 칩</p><p className="mt-5 border-l-2 border-brand/60 pl-4 text-sm leading-6 text-ink-2">여러 기능을 하나의 집적 회로에 구현한 반도체 시스템</p></div>
        <div className="mt-7 flex flex-wrap gap-2 border-t border-line pt-5"><span className="rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand">SoC · 약어</span><span className="rounded-full bg-panel-2 px-3 py-1.5 text-xs text-ink-2">시스템온칩 · 별칭</span><span className="rounded-full bg-panel-2 px-3 py-1.5 text-xs text-ink-2">반도체 · 분야</span></div>
      </div>
    </div>
  );
}

function JourneyCard({ number, title, body, icon }: { number: string; title: string; body: string; icon: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-paper/45 p-5 transition hover:border-line-strong"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-panel text-brand shadow-sm">{icon}</span><span className="font-mono text-[10px] text-ink-3">{number}</span></div><h3 className="mt-5 text-base font-semibold tracking-tight text-ink">{title}</h3><p className="mt-2 text-sm leading-6 text-ink-2">{body}</p></div>;
}

function Results({ q, hits }: { q: string; hits: SearchHit[] }) {
  if (hits.length === 0) return (
    <section className="mt-8 pb-16"><div className="card px-6 py-10 text-center shadow-sm"><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand"><IconPen /></span><p className="mt-4 text-sm text-ink-2"><span className="font-semibold text-ink">{q}</span>와(과) 맞는 표기가 아직 없습니다.</p><p className="mt-1.5 text-xs text-ink-3">다른 약어나 한국어·영어 이름으로 다시 검색하거나, 전체 목록에서 같은 개념이 있는지 확인해 보세요.</p><div className="mt-5 flex flex-wrap justify-center gap-2"><Link href="/sheet" className="btn-ghost rounded-full px-5 py-2.5">전체 용어 확인하기</Link><Link href={newTermHref(q)} className="btn-primary rounded-full px-5 py-2.5">새 용어 등록하기</Link></div></div></section>
  );
  return (
    <section className="mt-8 rounded-2xl border border-line bg-panel/70 p-3 pb-5 shadow-sm backdrop-blur sm:p-5">
      <p className="mb-2 px-3 text-xs text-ink-3">결과 <span className="font-medium text-ink-2">{hits.length}</span>개{hits.length === RESULT_LIMIT && " 이상"}<span className="mx-1.5">·</span><Link href={`/sheet?q=${encodeURIComponent(q)}`} className="link">시트에서 보기</Link></p>
      <p className="mb-3 px-3 text-xs leading-6 text-ink-2">금지·비권장 표기로 찾았다면 용어 상세에서 대표 표기와 사용 지침을 확인하세요.</p>
      <ol>{hits.map((hit) => <li key={hit.id}><Link href={termHref(hit)} className="flex gap-3 rounded-xl px-3 py-3 transition hover:bg-panel-2"><span aria-hidden className="mt-1 h-8 w-1 shrink-0 rounded-full bg-brand/60" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-[15px] font-medium text-ink">{displayName(hit)}</span>{hit.nameEn && hit.nameKo && <span className="text-sm text-ink-2">{hit.nameKo}</span>}{hit.matchedKind !== "canonical" && <span className="chip chip-on px-2 py-0.5 text-[11px]">{hit.matchedText}<span className="opacity-70">{SURFACE_KIND_LABEL[hit.matchedKind]}</span></span>}{!hit.exact && <span className="text-[11px] text-ink-3">비슷한 표기</span>}</span>{hit.definitionMd && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2">{hit.definitionMd}</span>}<span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3"><DomainBadges domain={hit.domain} />{hit.status !== "active" && <StatusBadge status={hit.status} />}</span></span></Link></li>)}</ol>
    </section>
  );
}

function HomeBackdrop() { return <div className="pointer-events-none absolute inset-x-0 top-14 h-80 bg-gradient-to-b from-brand/[0.025] to-transparent" aria-hidden />; }
function IconPlus() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>; }
function IconArrow() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 8h9M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function IconArrowDown() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M8 3v9M4.5 8.5 8 12l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function IconSearch() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="7.5" cy="7.5" r="4.5" /><path d="m11 11 3.5 3.5" strokeLinecap="round" /></svg>; }
function IconPen() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m11.3 3.2 3.5 3.5-8.7 8.7-3.9.4.4-3.9 8.7-8.7Z" strokeLinejoin="round" /><path d="m9.8 4.7 3.5 3.5" /></svg>; }
function IconPeople() { return <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><circle cx="7" cy="6" r="2.5" /><path d="M2.5 15c.3-3 1.8-4.5 4.5-4.5s4.2 1.5 4.5 4.5" strokeLinecap="round" /><path d="M12.5 4.5a2.4 2.4 0 0 1 0 4.7M13 11c2.1.2 3.2 1.5 3.5 4" strokeLinecap="round" /></svg>; }
function IconMenu() { return <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 4.5h11M3 8.5h11M3 12.5h11" strokeLinecap="round" /></svg>; }
function IconGrid() { return <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="2.5" y="2.5" width="5" height="5" rx=".8" /><rect x="9.5" y="2.5" width="5" height="5" rx=".8" /><rect x="2.5" y="9.5" width="5" height="5" rx=".8" /><rect x="9.5" y="9.5" width="5" height="5" rx=".8" /></svg>; }
