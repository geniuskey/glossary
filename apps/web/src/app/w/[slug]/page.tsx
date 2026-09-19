import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MarkdownContent } from "@/components/markdown-content";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { relativeTime } from "@/lib/ui/format";
import { getWikiPageBySlug } from "@/lib/wiki/store";

export const metadata = { title: "위키" };

const STATUS_LABEL = { draft: "초안", published: "공개", archived: "보관" } as const;

/** 옛 `/w/<용어>` 링크는 깨뜨리지 않고 새 용어 경로 `/g/<slug>`로 정규화한다. */
export default async function WikiDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  const page = await getWikiPageBySlug(slug);
  if (!page) {
    const legacyTerm = await getTermByIdOrSlug(slug);
    if (legacyTerm) redirect(`/g/${legacyTerm.slug}`);
    notFound();
  }

  return (
    <AppShell user={user} title={page.title} current="wiki" roomy>
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/w" className="link">위키</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{page.slug}</span>
      </nav>

      <article className="animate-fade-up">
        <header className="border-b border-line pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Wiki knowledge</p>
              <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-ink">{page.title}</h1>
              <p className="mt-2 text-xs text-ink-3">/w/{page.slug} · 리비전 {page.revision} · 최근 수정 {relativeTime(page.updatedAt)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href={`/w/${page.slug}/edit`} className="btn-primary btn-sm">편집</Link>
              <Link href="/w/new" className="btn-ghost btn-sm">새 문서</Link>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-1 font-medium ${page.status === "published" ? "bg-ok-soft text-ok" : page.status === "archived" ? "bg-panel-2 text-ink-3" : "bg-warn-soft text-warn"}`}>
              {STATUS_LABEL[page.status]}
            </span>
            {page.domain.map((domain) => <span key={domain} className="rounded-full bg-brand-soft px-2.5 py-1 text-brand">{domain}</span>)}
          </div>
          {page.sourceUrl && <p className="mt-4 text-xs text-ink-3">원문 출처: <a href={page.sourceUrl} target="_blank" rel="noreferrer" className="link break-all">Confluence 원문 열기</a></p>}
        </header>

        {page.terms.length > 0 && <section className="mt-5" aria-labelledby="wiki-terms-heading">
          <h2 id="wiki-terms-heading" className="label mb-2">연결된 용어</h2>
          <div className="flex flex-wrap gap-2">
            {page.terms.map((term) => <Link key={term.id} href={`/g/${term.slug}`} className={`rounded-lg border px-3 py-2 text-sm hover:border-brand/45 hover:text-brand ${term.role === "primary" ? "border-brand/35 bg-brand-soft/45 font-medium text-brand" : "border-line bg-panel text-ink-2"}`}>
              {term.title}
            </Link>)}
          </div>
        </section>}

        {page.summary && <section className="mt-6 rounded-xl border border-brand/20 bg-brand-soft/35 p-4" aria-labelledby="wiki-summary-heading">
          <h2 id="wiki-summary-heading" className="label mb-1">요약</h2>
          <p className="text-sm leading-6 text-ink-2">{page.summary}</p>
        </section>}

        <section className="mt-6" aria-labelledby="wiki-content-heading">
          <h2 id="wiki-content-heading" className="sr-only">본문</h2>
          <div className="card p-4 sm:p-6"><MarkdownContent>{page.content}</MarkdownContent></div>
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-ink-3">
          <span>위키 문서는 검토·승인된 조직 맥락으로 AI 검색에 사용됩니다. 현재 리비전 {page.revision}</span>
          <Link href={`/w/${page.slug}/edit`} className="link">문서 편집</Link>
        </footer>
      </article>
    </AppShell>
  );
}
