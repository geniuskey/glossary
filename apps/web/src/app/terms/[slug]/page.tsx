import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { isUuid } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const KIND_LABEL: Record<string, string> = {
  canonical: "표준",
  abbreviation: "약어",
  full_name: "풀네임",
  alias: "별칭",
  discouraged: "비권장",
  forbidden: "금지",
};

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

  return (
    <AppShell user={user}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{term.nameEn ?? term.nameKo}</h1>
          {term.nameEn && term.nameKo && <p className="mt-1 text-slate-600">{term.nameKo}</p>}
          {term.fullNameEn && <p className="mt-1 text-sm text-slate-500">{term.fullNameEn}</p>}
          <div className="mt-2 flex items-center gap-2">
            <DomainBadges domain={term.domain} />
            <StatusBadge status={term.status} />
          </div>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href={`/terms/${term.slug}/edit`} className="text-slate-600 hover:text-slate-900">
            편집
          </Link>
          <Link href={`/terms/${term.slug}/history`} className="text-slate-600 hover:text-slate-900">
            이력
          </Link>
        </div>
      </div>

      {term.homonyms.length > 0 && (
        <div className="mb-6 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-900">같은 표기의 다른 용어가 있습니다</p>
          <ul className="space-y-0.5">
            {term.homonyms.map((h) => (
              <li key={h.id}>
                <Link href={`/terms/${h.slug}`} className="text-amber-900 underline">
                  {h.nameEn ?? h.nameKo}
                </Link>
                {h.domain.length > 0 && <span className="ml-2 text-amber-700">({h.domain.join(", ")})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* R96: M3(마크다운 렌더러·이미지·diff/revert) 범위 밖 — definitionMd/
          bodyMd는 렌더러 없이 텍스트로 보여준다. whitespace-pre-wrap이 없으면
          여러 줄 정의가 한 줄로 뭉개진다. */}
      {term.definitionMd && (
        <p className="mb-6 whitespace-pre-wrap text-slate-800">{term.definitionMd}</p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">등록된 표기</h2>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {term.surfaces.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{s.text}</span>
              <span className="text-slate-500">
                {KIND_LABEL[s.kind] ?? s.kind} · {s.lang}
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
          <h2 className="mb-2 text-sm font-semibold text-slate-500">본문</h2>
          <p className="whitespace-pre-wrap text-slate-800">{term.bodyMd}</p>
        </section>
      )}
    </AppShell>
  );
}
