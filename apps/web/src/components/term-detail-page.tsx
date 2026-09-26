import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { surfaceKeys } from "@glossary/db";
import { AppShell } from "@/components/app-shell";
import { CopyTermButton } from "@/components/copy-term-button";
import { HelpTip } from "@/components/help-tip";
import { MarkdownContent } from "@/components/markdown-content";
import { CompletionBadge, CompletionProgress, MissingFields } from "@/components/term-completion";
import { CategoryBadges, DomainBadges, OwnerBadge, StatusBadge, TagBadges } from "@/components/term-badges";
import { isUuid } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { businessCategoryLabel } from "@/lib/terms/enums";
import { termCompletion } from "@/lib/terms/completion";
import { lookupTerms } from "@/lib/terms/lookup";
import { listRelatedTerms, type SurfaceKind, type TermSummary } from "@/lib/terms/query";
import { loadTermForPage } from "@/lib/terms/page-metadata";
import { displayName, relativeTime } from "@/lib/ui/format";
import { getTermQualitySettings } from "@/lib/workspace/term-quality";
import { mergedDestination } from "@/lib/terms/merge";
import { listWikiPagesForTerm } from "@/lib/wiki/store";

// F6/P1: `Record<유니온, T>` + 폴백 없음. SurfaceKind에 값이 추가되면 tsc가 여기서 막는다.
const KIND_LABEL: Record<SurfaceKind, string> = {
  canonical: "표준",
  abbreviation: "약어",
  full_name: "풀네임",
  alias: "별칭",
  discouraged: "비권장",
  forbidden: "금지",
};

// 표기는 "써도 되는 것"과 "쓰면 안 되는 것"이 한 목록에 섞여 있다. 라벨만으로는
// 훑을 때 구분이 안 되므로 비권장/금지에만 색을 준다.
const KIND_TONE: Record<SurfaceKind, string> = {
  canonical: "bg-brand-soft text-brand",
  abbreviation: "bg-panel-2 text-ink-2",
  full_name: "bg-panel-2 text-ink-2",
  alias: "bg-panel-2 text-ink-2",
  discouraged: "bg-warn-soft text-warn",
  forbidden: "bg-danger-soft text-danger",
};

const LANG_LABEL: Record<string, string> = { en: "영문", ko: "국문", neutral: "공통" };

function decodeSlugParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function SurfaceChooser({ user, text, terms }: { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; text: string; terms: TermSummary[] }) {
  return (
    <AppShell user={user} title={text}>
      <article className="animate-fade-up rounded-2xl border border-line bg-panel p-5 sm:p-8">
        <p className="mb-2 text-[11px] font-medium text-ink-3">동음이의어</p>
        <h2 className="break-words text-3xl font-semibold tracking-[-0.035em]">{text}</h2>
        <p className="mt-2 text-sm text-ink-2">이 표기는 용어 {terms.length}개에 쓰입니다. 뜻하는 용어를 골라 주세요.</p>
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {terms.map((candidate) => (
            <li key={candidate.id}>
              <Link href={`/g/${candidate.slug}?from=${encodeURIComponent(text)}`} className="flex flex-wrap items-center gap-2 py-3 hover:text-brand">
                <span className="font-medium">{displayName(candidate)}</span>
                {candidate.nameEn && candidate.nameKo && <span className="text-sm text-ink-3">{candidate.nameKo}</span>}
                <DomainBadges domain={candidate.domain} />
                <StatusBadge status={candidate.status} />
              </Link>
            </li>
          ))}
        </ul>
      </article>
    </AppShell>
  );
}

/**
 * R135: 주소는 `/g/<slug>`다(나무위키식). 짧은 것 말고도 얻는 게 있다 — 슬러그가
 * `/g/` 아래에만 살게 되면서 `new`·`import` 같은 화면 이름과 슬러그가 같은
 * 네임스페이스에서 부딪히지 않는다(R86/R92가 두 번 반복해 막았던 결함이
 * 구조적으로 사라진다).
 */
export async function TermDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await loadTermForPage(slug);
  const fromRaw = (await searchParams).from;
  const fromText = (Array.isArray(fromRaw) ? fromRaw[0] : fromRaw)?.trim();
  if (!term) {
    // 약어는 어떤 개념의 slug도 아니다(slugSeed가 풀네임을 쓴다). `/g/sla`는
    // 표기로 풀어 뜻이 하나면 그 개념으로, 여럿이면 고르는 화면으로 보낸다
    // (Wikipedia의 동음이의 문서). 선점한 개념이 없으니 뜻이 늘어도 주소가 안 바뀐다.
    const text = decodeSlugParam(slug);
    const [match] = await lookupTerms([text]);
    const candidates = match?.terms ?? [];
    if (candidates.length === 1) redirect(`/g/${candidates[0]!.slug}?from=${encodeURIComponent(text)}`);
    if (candidates.length > 1) return <SurfaceChooser user={user} text={text} terms={candidates} />;
    notFound();
  }
  const destination = await mergedDestination(term.id);
  if (destination) redirect(`/g/${destination}`);

  // R98: getTermByIdOrSlug는 UUID도 slug도 받으므로 같은 문서에 URL이 두 개
  // 생긴다. 위키에서 "용어 하나에 페이지 하나"는 링크와 중복 판단의 기반이라,
  // UUID나 옛 slug로 들어온 요청은 정식 slug URL로 정규화한다. 308이 아니라 307인
  // 이유: 자기 옛 slug로 되돌리면 옛/새가 뒤바뀌는데, 브라우저가 캐시한 308은
  // 그때 리다이렉트 루프가 된다.
  // 옛 약어 slug(`/g/sla`)로 들어왔으면 그 약어가 곧 "무슨 말로 찾아 들어왔는가"다.
  // 나무위키 넘어옴처럼 ?from=으로 넘겨, 옛 링크로 온 사람도 이 개념의 약어라는 걸
  // 보게 한다. `gain-2` 같은 옛 slug는 표기가 아니라 아래 표기 대조에서 걸러진다.
  const requested = decodeSlugParam(slug);
  if (term.slug !== requested) {
    const requestedKey = isUuid(requested) ? "" : surfaceKeys(requested).normLoose;
    const via = fromText || term.surfaces.find((s) => requestedKey && surfaceKeys(s.text).normLoose === requestedKey)?.text;
    redirect(`/g/${term.slug}${via ? `?from=${encodeURIComponent(via)}` : ""}`);
  }

  // R135: `?from=`은 "무슨 말로 찾아 들어왔는가"다(나무위키의 넘어옴 표시).
  // 이 사전에서는 그게 부가 정보가 아니라 답 자체다 — "SoC"를 친 사람은 자기가
  // 쓴 말이 이 개념의 **약어**라는 걸 알아야 다음부터 바르게 쓴다.
  //
  // 등록된 표기와 맞을 때만 보여준다. 쿼리스트링은 아무나 손으로 고칠 수 있어서,
  // 그대로 되뇌면 이 사전이 인정한 적 없는 표기를 이 용어의 표기인 것처럼
  // 보여주게 된다. 비교는 engine의 정규화(surfaceKeys)로 한다 — 화면에서
  // 소문자 비교 같은 걸 새로 만들면 DB의 norm_loose와 조용히 갈라진다.
  const fromKey = fromText ? surfaceKeys(fromText).normLoose : "";
  const fromSurface = fromKey
    ? term.surfaces.find((s) => s.kind !== "canonical" && surfaceKeys(s.text).normLoose === fromKey)
    : undefined;

  const [qualitySettings, relatedTerms, wikiPages] = await Promise.all([
    getTermQualitySettings(),
    listRelatedTerms(term, 6),
    listWikiPagesForTerm(term.id, 6),
  ]);
  const completion = termCompletion(term, qualitySettings);
  const graphHref = term.category
    ? `/graph?category=${encodeURIComponent(term.category)}`
    : term.tags[0]
      ? `/graph?tag=${encodeURIComponent(term.tags[0])}`
      : term.domain[0]
      ? `/graph?domain=${encodeURIComponent(term.domain[0])}`
      : "/graph";

  return (
    <AppShell user={user} title={displayName(term)}>
      <nav aria-label="현재 위치" className="mb-5 text-xs text-ink-3">
        <Link href="/sheet" className="link">
          시트
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">{displayName(term)}</span>
      </nav>

      <article className="animate-fade-up rounded-2xl border border-line bg-panel p-5 sm:p-8">
        <div className="flex flex-wrap items-start gap-4">
          {/* 책등은 브랜드색으로 통일한다. 분야별 색상은 도메인에만 쓴다. */}
          <span
            aria-hidden
            className="mt-1.5 h-14 w-1 shrink-0 rounded-full bg-brand"
          />
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[11px] font-medium text-ink-3">용어 사전</p>
            <h2 className="break-words text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{displayName(term)}</h2>
            {term.nameEn && term.nameKo && <p className="mt-0.5 text-ink-2">{term.nameKo}</p>}
            {/* F3: fullNameKo는 스키마·생성·수정·API 응답에 전부 있는데 화면에는
                없었다 — R96이 bodyMd에 편 논리("저장만 되고 화면 어디에도 없으면
                사용자는 자기가 쓴 값이 유실됐다고 믿는다")가 그대로 적용된다. */}
            {(term.fullNameEn || term.fullNameKo) && (
              <p className="mt-1.5 text-sm text-ink-3">
                {[term.fullNameEn, term.fullNameKo].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="mt-2"><CopyTermButton text={displayName(term)} /></div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/graph?view=semantic&focus=${encodeURIComponent(term.slug)}`} className="btn-ghost btn-sm">
              의미 관계
            </Link>
            <Link href={`/edit/${term.slug}#ai-review-heading`} className="btn-ghost btn-sm">
              AI 검토
            </Link>
            <Link href={`/edit/${term.slug}`} className="btn-primary btn-sm">
              편집
            </Link>
            <Link href={`/history/${term.slug}`} className="btn-ghost btn-sm">
              이력
            </Link>
          </div>
        </div>

        {term.definitionMd && (
          <section className="mt-6 border-l-2 border-brand/40 bg-paper px-5 py-4 text-lg leading-relaxed" aria-labelledby="definition-heading">
            <h2 id="definition-heading" className="mb-2 text-xs font-medium text-ink-3">한줄 정의</h2>
            <MarkdownContent>{term.definitionMd}</MarkdownContent>
          </section>
        )}

        {fromSurface && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
            <span className="text-ink-3">검색한 표현</span>
            <span className="font-medium text-ink">{fromSurface.text}</span>
            <span className="text-ink-3">· 이 개념에 등록된</span>
            <span className="text-ink-2">{LANG_LABEL[fromSurface.lang] ?? fromSurface.lang}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_TONE[fromSurface.kind]}`}>
              {KIND_LABEL[fromSurface.kind]}
            </span>
            <span className="text-ink-3">표기입니다.</span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <StatusBadge status={term.status} />
          <DomainBadges domain={term.domain} />
          <CategoryBadges categories={term.categories} labels={term.categoryLabels} />
          <TagBadges tags={term.tags} />
        </div>


        {term.homonyms.length > 0 && (
          <div className="note note-warn mt-5">
            <p className="font-medium">같은 표기의 다른 용어가 있습니다</p>
            <ul className="mt-1 space-y-0.5">
              {term.homonyms.map((h) => (
                <li key={h.id}>
                  <Link href={`/g/${h.slug}`} className="underline underline-offset-2">
                    {displayName(h)}
                  </Link>
                  {h.domain.length > 0 && <span className="ml-2 opacity-80">({h.domain.join(", ")})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="mt-6" aria-labelledby="surfaces-heading">
          <h2 id="surfaces-heading" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
            이 개념을 가리키는 표기
            <HelpTip text="아래 표현으로 검색해도 모두 이 개념으로 연결됩니다." />
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {term.surfaces.map((s) => {
              const selected = fromSurface?.id === s.id;
              return (
                <li
                  key={s.id}
                  className={`flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selected ? "border-brand/45 bg-brand-soft/55" : "border-line bg-panel"}`}
                >
                  <span className="min-w-0 break-words font-medium text-ink">{s.text}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{LANG_LABEL[s.lang] ?? s.lang}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_TONE[s.kind]}`}>
                    {KIND_LABEL[s.kind]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {term.bodyMd && (
          <section className="mt-8 border-t border-line pt-6">
            <h2 className="mb-4 text-sm font-semibold text-ink">자세한 설명과 사용 맥락</h2>
            <MarkdownContent>{term.bodyMd}</MarkdownContent>
          </section>
        )}

        {relatedTerms.length > 0 && (
          <section className="mt-8 border-t border-line pt-6" aria-labelledby="related-terms-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="related-terms-heading" className="inline-flex items-center gap-1.5 text-base font-semibold text-ink text-balance">
                  같이 보면 좋은 용어
                  <HelpTip text="같은 도메인, 업무 분류나 태그에서 이어지는 개념입니다." />
                </h2>
              </div>
              <Link href={graphHref} className="btn-ghost btn-sm shrink-0">
                관계도에서 보기 <IconArrow />
              </Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {relatedTerms.map((related) => (
                <li key={related.id} className="min-w-0">
                  <Link
                    href={`/g/${related.slug}`}
                    className="group block min-h-full rounded-xl border border-line bg-panel p-3.5 transition-[border-color,background-color,box-shadow] hover:border-line-strong hover:bg-panel-2/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold text-ink group-hover:text-brand">{displayName(related)}</span>
                        {related.nameEn && related.nameKo && (
                          <span className="mt-0.5 block truncate text-xs text-ink-3">{related.nameKo}</span>
                        )}
                      </span>
                      {related.status !== "active" && <StatusBadge status={related.status} />}
                      <IconArrow />
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                      {related.sameCategory && related.category && (
                        <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">같은 업무 분류 · {businessCategoryLabel(related.category, related.categoryLabel)}</span>
                      )}
                      {related.sameTopic && (
                        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">공통 태그</span>
                      )}
                      {related.sharedDomains.map((domain) => (
                        <span key={domain} className="rounded bg-panel-2 px-1.5 py-0.5">같은 도메인 · {domain}</span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {wikiPages.length > 0 && (
          <section className="mt-8 border-t border-line pt-6" aria-labelledby="related-wiki-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="related-wiki-heading" className="text-base font-semibold text-ink">이 용어를 이해하는 위키</h2>
                <p className="mt-1 text-xs text-ink-3">업무 맥락과 적용 방법을 더 자세히 볼 수 있습니다.</p>
              </div>
              <Link href="/w" className="btn-ghost btn-sm">위키 전체 보기</Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {wikiPages.map((page) => <li key={page.id}>
                <Link href={`/w/${page.slug}`} className="group block rounded-xl border border-line bg-panel p-3.5 hover:border-brand/40 hover:bg-brand-soft/15">
                  <span className="block break-words text-sm font-semibold text-ink group-hover:text-brand">{page.title}</span>
                  {page.summary && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-ink-2">{page.summary}</span>}
                  <span className="mt-2 block text-[11px] text-ink-3">위키 리비전 {page.revision} · {page.status === "published" ? "공개" : "초안"}</span>
                </Link>
              </li>)}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-xs text-ink-3" aria-label="관리 정보">
          <span className="font-medium text-ink-2">관리 정보</span>
          <CompletionBadge completion={completion} />
          <OwnerBadge ownerName={term.ownerName} mine={term.ownerId === user.id} />
          {/* F4: R40이 updatedAt을 TermDetail에 정식으로 추가한 이유가 "위키
              상세 페이지는 최근 수정을 보여줘야 한다"였는데, 그 화면이 지금
              한 번도 쓰지 않고 있었다. 함께 쓰는 사전에서는 "얼마나 최근 것인가"가
              먼저 읽혀야 하므로 상대 시간으로 보여준다(lib/ui/format.ts). */}
          <span className="ml-auto text-xs text-ink-3" title={term.updatedAt.toISOString()}>
            최근 수정 {relativeTime(term.updatedAt)}
          </span>
        </div>

        {!completion.complete && (
          <section className="mt-5 rounded-xl border border-warn/35 bg-warn-soft p-4 sm:p-5" aria-labelledby="completion-heading">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h2 id="completion-heading" className="text-sm font-semibold text-ink text-balance">
                  이 용어는 아직 함께 정리 중입니다
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-2">
                  아래 항목 중 알고 있는 것 하나만 보태 주세요. 완벽하지 않아도 다음 사람이 이어서 다듬을 수 있습니다.
                </p>
                {term.status === "draft" && (
                  <p className="mt-1 text-xs leading-5 text-ink-3">초안은 기본 검색과 AI 조회에 나타나지 않습니다.</p>
                )}
                <div className="mt-3 max-w-sm"><CompletionProgress completion={completion} /></div>
                <div className="mt-2.5"><MissingFields completion={completion} /></div>
              </div>
              <Link href={`/edit/${term.slug}`} className="btn-primary shrink-0 self-start sm:self-auto">
                정리 이어가기
              </Link>
            </div>
          </section>
        )}
      </article>
    </AppShell>
  );
}

function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="shrink-0">
      <path d="M3 8h9M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
