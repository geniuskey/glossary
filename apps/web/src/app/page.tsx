import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/app-shell";
import { LogoutButton } from "@/components/logout-button";
import { SearchBox } from "@/components/search-box";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth/current-user";
import { needsSetup } from "@/lib/auth/setup";
import { SURFACE_KIND_LABEL, TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { termFacets } from "@/lib/terms/query";
import { searchTerms, type SearchHit } from "@/lib/terms/search";
import { termHref } from "@/lib/terms/search-ui";
import { cx, displayName, spineHue } from "@/lib/ui/format";

// needsSetup은 요청 시 DB를 읽는다. 빌드 시(도커 이미지 빌드엔 DB가 없다)
// 프리렌더로 실행되지 않도록 런타임 렌더로 고정한다.
export const dynamic = "force-dynamic";

// 결과는 "찾았다"를 확인하는 목록이지 훑는 표가 아니다. 이보다 넓게 봐야 하는
// 검색이면 필터·정렬·페이징이 있는 시트로 가는 게 맞다.
const RESULT_LIMIT = 20;

/**
 * R135: 홈은 검색 화면이다. 예전에는 `/terms`(표)로 리다이렉트했는데, 사전을
 * 쓰는 사람은 열에 아홉 "이 말이 뭐였지"를 확인하러 오지 표를 고치러 오지
 * 않는다 — 50줄짜리 스프레드시트가 첫 화면이면 매번 필터부터 찾아야 한다.
 * 표는 `/sheet`에 그대로 있다.
 *
 * R136: 검색창은 SearchBox(Client Component)지만 그 안은 여전히 평범한 GET
 * 폼이다 — 결과가 주소(`/?q=`)에 남아야 공유·뒤로가기·새로고침이 그대로
 * 동작하고, 자바스크립트가 없어도 검색이 된다. 자동완성은 그 위에 얹은 것이라
 * 꺼져도 이 화면은 예전과 똑같이 동작한다.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (await needsSetup()) redirect("/setup");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const raw = await searchParams;
  const rawQ = Array.isArray(raw.q) ? raw.q[0] : raw.q;
  const q = (rawQ ?? "").trim();

  const [hits, facets] = await Promise.all([
    q ? searchTerms(q, RESULT_LIMIT) : Promise.resolve<SearchHit[]>([]),
    termFacets(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* 홈은 AppShell(사이드바)을 쓰지 않는다 — 검색창 하나만 남기는 것이 이
          화면의 전부라, 네비게이션은 구석의 작은 링크로 충분하다. */}
      <header className="flex items-center justify-end gap-1 px-4 py-3">
        <span className="mr-1 hidden text-xs text-ink-3 sm:inline">{user.name || user.email}</span>
        <Link href="/sheet" className="btn-quiet btn-sm">
          시트
        </Link>
        <Link href="/import" className="btn-quiet btn-sm">
          가져오기
        </Link>
        <Link href="/settings/api-keys" className="btn-quiet btn-sm">
          설정
        </Link>
        <ThemeToggle />
        <LogoutButton />
      </header>

      <main
        className={cx(
          "mx-auto flex w-full max-w-2xl flex-1 flex-col px-5",
          // 검색 전에는 화면 한가운데, 검색 후에는 위로 붙인다 — 결과가 접히지
          // 않고 바로 보여야 한다.
          q ? "pt-4" : "justify-center pb-28",
        )}
      >
        <div className="flex flex-col items-center">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Grossary 홈">
            <BrandMark />
            <span className="text-2xl font-semibold tracking-tight">Grossary</span>
          </Link>
          {!q && (
            <p className="mt-2 text-sm text-ink-3">개념 하나에 표기 여럿 — 어느 표기로 찾아도 같은 곳에 닿습니다.</p>
          )}
        </div>

        <SearchBox defaultValue={q} />

        {q ? (
          <Results q={q} hits={hits} />
        ) : (
          <p className="mt-6 text-center text-xs text-ink-3">
            등록된 개념 <span className="font-medium text-ink-2">{facets.total.toLocaleString("ko-KR")}</span>개
            <span className="mx-1.5">·</span>
            <Link href="/new" className="link">
              새 용어 등록
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}

function Results({ q, hits }: { q: string; hits: SearchHit[] }) {
  if (hits.length === 0) {
    return (
      <section className="mt-8 pb-16">
        <div className="card px-6 py-8 text-center">
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">{q}</span>와(과) 맞는 표기가 없습니다.
          </p>
          {/* 오타까지 함께 찾고 있다는 사실을 여기서 말해 줘야, 사용자가 철자만
              바꿔 가며 같은 검색을 반복하지 않는다. */}
          <p className="mt-1.5 text-xs text-ink-3">
            비슷한 표기까지 함께 찾았습니다. 아직 등록되지 않은 말일 수 있습니다.
          </p>
          <Link href="/new" className="btn-primary btn-sm mt-5">
            새 용어로 등록
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-7 pb-16">
      <p className="mb-2 px-3 text-xs text-ink-3">
        결과 <span className="font-medium text-ink-2">{hits.length}</span>개{hits.length === RESULT_LIMIT && " 이상"}
        <span className="mx-1.5">·</span>
        <Link href={`/sheet?q=${encodeURIComponent(q)}`} className="link">
          시트에서 보기
        </Link>
      </p>
      <ol>
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link href={termHref(hit)} className="flex gap-3 rounded-xl px-3 py-2.5 transition hover:bg-panel-2">
              <span
                aria-hidden
                className="mt-1 h-8 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(${spineHue(hit.slug)} 62% 55%)` }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[15px] font-medium text-ink">{displayName(hit)}</span>
                  {hit.nameEn && hit.nameKo && <span className="text-sm text-ink-2">{hit.nameKo}</span>}
                  {/* canonical은 표준명 자체라 배지가 동어반복이 된다. 그 외 표기로
                      맞았을 때만 무엇으로 맞았는지 보여준다 — "SoC로 찾았더니
                      System on Chip이 나온" 이유가 이 배지다. */}
                  {hit.matchedKind !== "canonical" && (
                    <span className="chip chip-on px-2 py-0.5 text-[11px]">
                      {hit.matchedText}
                      <span className="opacity-70">{SURFACE_KIND_LABEL[hit.matchedKind]}</span>
                    </span>
                  )}
                  {!hit.exact && <span className="text-[11px] text-ink-3">비슷한 표기</span>}
                </span>
                {hit.definitionMd && (
                  <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2">{hit.definitionMd}</span>
                )}
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <span>{TERM_TYPE_LABEL[hit.termType]}</span>
                  <DomainBadges domain={hit.domain} />
                  {hit.status !== "active" && <StatusBadge status={hit.status} />}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
