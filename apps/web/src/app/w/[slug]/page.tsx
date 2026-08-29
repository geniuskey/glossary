import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { isUuid } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { getTermByIdOrSlug, type SurfaceKind } from "@/lib/terms/query";
import { displayName, relativeTime, spineHue } from "@/lib/ui/format";

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

export default async function TermDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const term = await getTermByIdOrSlug(slug);
  if (!term) notFound();

  // R98: getTermByIdOrSlug는 UUID도 slug도 받으므로 같은 문서에 URL이 두 개
  // 생긴다. 위키에서 "용어 하나에 페이지 하나"는 링크와 중복 판단의 기반이라,
  // UUID로 들어온 요청은 정식 slug URL로 정규화한다.
  if (isUuid(slug)) redirect(`/terms/${term.slug}`);

  const hue = spineHue(term.slug);

  return (
    <AppShell user={user} current="terms">
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/terms" className="link">
          용어집
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{term.slug}</span>
      </nav>

      <article className="animate-fade-up">
        <div className="flex items-start gap-4">
          {/* 목록의 책등 색과 같은 색을 상세에도 둔다 — 같은 용어를 다시 열었을 때
              "아까 그 카드"라는 감각이 이어지게 하려는 장치다(spineHue). */}
          <span
            aria-hidden
            className="mt-1.5 h-14 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: `hsl(${hue} 62% 55%)` }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{displayName(term)}</h1>
            {term.nameEn && term.nameKo && <p className="mt-0.5 text-ink-2">{term.nameKo}</p>}
            {/* F3: fullNameKo는 스키마·생성·수정·API 응답에 전부 있는데 화면에는
                없었다 — R96이 bodyMd에 편 논리("저장만 되고 화면 어디에도 없으면
                사용자는 자기가 쓴 값이 유실됐다고 믿는다")가 그대로 적용된다. */}
            {(term.fullNameEn || term.fullNameKo) && (
              <p className="mt-1.5 text-sm text-ink-3">
                {[term.fullNameEn, term.fullNameKo].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Link href={`/terms/${term.slug}/edit`} className="btn-primary btn-sm">
              편집
            </Link>
            <Link href={`/terms/${term.slug}/history`} className="btn-ghost btn-sm">
              이력
            </Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <StatusBadge status={term.status} />
          <span className="chip">{TERM_TYPE_LABEL[term.termType]}</span>
          <DomainBadges domain={term.domain} />
          {/* F4: R40이 updatedAt을 TermDetail에 정식으로 추가한 이유가 "위키
              상세 페이지는 최근 수정을 보여줘야 한다"였는데, 그 화면이 지금
              한 번도 쓰지 않고 있었다. 함께 쓰는 사전에서는 "얼마나 최근 것인가"가
              먼저 읽혀야 하므로 상대 시간으로 보여준다(lib/ui/format.ts). */}
          <span className="ml-auto text-xs text-ink-3" title={term.updatedAt.toISOString()}>
            최근 수정 {relativeTime(term.updatedAt)}
          </span>
        </div>

        {term.homonyms.length > 0 && (
          <div className="note note-warn mt-5">
            <p className="font-medium">같은 표기의 다른 용어가 있습니다</p>
            <ul className="mt-1 space-y-0.5">
              {term.homonyms.map((h) => (
                <li key={h.id}>
                  <Link href={`/terms/${h.slug}`} className="underline underline-offset-2">
                    {displayName(h)}
                  </Link>
                  {h.domain.length > 0 && <span className="ml-2 opacity-80">({h.domain.join(", ")})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* R96: M3(마크다운 렌더러·이미지·diff/revert) 범위 밖 — definitionMd/
            bodyMd는 렌더러 없이 텍스트로 보여준다. whitespace-pre-wrap이 없으면
            여러 줄 정의가 한 줄로 뭉개진다. */}
        {term.definitionMd && (
          <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{term.definitionMd}</p>
        )}

        <section className="mt-6">
          <h2 className="label mb-2">등록된 표기 {term.surfaces.length}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {term.surfaces.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.text}</span>
                <span className="text-xs text-ink-3">{LANG_LABEL[s.lang] ?? s.lang}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_TONE[s.kind]}`}>
                  {KIND_LABEL[s.kind]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* R96: bodyMd는 R33이 추가한 컬럼이라 저장은 이미 되고 있었는데, 계획서
            스케치에는 화면 어디에도 노출되지 않았다 — 그대로 두면 사용자는 자기가
            쓴 본문이 유실됐다고 믿는다. */}
        {term.bodyMd && (
          <section className="mt-6">
            <h2 className="label mb-2">본문</h2>
            <div className="card">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{term.bodyMd}</p>
            </div>
          </section>
        )}
      </article>
    </AppShell>
  );
}
