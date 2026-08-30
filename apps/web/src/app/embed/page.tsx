import Link from "next/link";
import { CategoryBadge, DomainBadges, OwnerBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { listGraphTerms } from "@/lib/terms/query";
import { displayName } from "@/lib/ui/format";

export const metadata = { title: "용어 모음" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, DOMAIN_VALUE_MAX) || undefined;
}

export default async function EmbedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper p-6">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-base font-semibold">Grossary 로그인이 필요합니다</h1>
          <p className="mt-2 text-sm leading-6 text-ink-2">새 창에서 로그인한 뒤 이 Confluence 블록을 새로고침해 주세요. 계속 보이면 두 서비스가 같은 사이트 범위에서 운영되는지 확인하세요.</p>
          <Link href="/login" target="_blank" className="btn-primary mt-4">새 창에서 로그인</Link>
        </div>
      </main>
    );
  }
  const params = await searchParams;
  const domain = first(params.domain);
  const category = first(params.category);
  const terms = await listGraphTerms({ domain, category, limit: 200, includeDraft: false });

  return (
    <main className="min-h-screen bg-paper p-4 sm:p-6">
      <header className="mb-4 border-b border-line pb-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand">GROSSARY · EMBED</p>
        <h1 className="mt-1 text-lg font-semibold">{category ?? domain ?? "용어 모음"}</h1>
        <p className="mt-1 text-xs text-ink-3">{[domain && `도메인 ${domain}`, category && `카테고리 ${category}`, `공개 용어 ${terms.length}개`].filter(Boolean).join(" · ")}</p>
      </header>
      <ul className="grid gap-2 sm:grid-cols-2">
        {terms.map((term) => (
          <li key={term.id} className="card p-3">
            <Link href={`/w/${term.slug}`} target="_blank" className="font-medium text-ink hover:underline">{displayName(term)}</Link>
            {term.definitionMd && <p className="mt-1 line-clamp-3 text-sm leading-5 text-ink-2">{term.definitionMd}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1"><DomainBadges domain={term.domain} /><CategoryBadge category={term.category} /><OwnerBadge ownerName={term.ownerName} /></div>
          </li>
        ))}
      </ul>
      {terms.length === 0 && <p className="card px-4 py-10 text-center text-sm text-ink-3">조건에 맞는 공개 용어가 없습니다.</p>}
    </main>
  );
}
