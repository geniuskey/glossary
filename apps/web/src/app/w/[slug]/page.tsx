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
      <article className="animate-fade-up">
        <header className="border-b border-line pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight text-ink">{page.title}</h1>
            <div className="flex shrink-0 gap-2">
              <Link href={`/w/${page.slug}/edit`} className="btn-primary btn-sm">편집</Link>
              <Link href="/w/new" className="btn-ghost btn-sm">새 문서</Link>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span className={`rounded-full px-2.5 py-1 font-medium ${page.status === "published" ? "bg-ok-soft text-ok" : page.status === "archived" ? "bg-panel-2 text-ink-3" : "bg-warn-soft text-warn"}`}>
              {STATUS_LABEL[page.status]}
            </span>
            {page.domain.map((domain) => <span key={domain} className="rounded-full bg-brand-soft px-2.5 py-1 text-brand">{domain}</span>)}
            <span>리비전 {page.revision} · 최근 수정 {relativeTime(page.updatedAt)}</span>
            {page.sourceUrl && <a href={page.sourceUrl} target="_blank" rel="noreferrer" className="link">원문 열기</a>}
          </div>
        </header>

        {page.summary && <section className="card mt-6 p-4 sm:p-6" aria-labelledby="wiki-summary-heading">
          <h2 id="wiki-summary-heading" className="label mb-1.5">요약</h2>
          <p className="text-sm leading-6 text-ink">{page.summary}</p>
        </section>}

        <section className="mt-4" aria-labelledby="wiki-content-heading">
          <h2 id="wiki-content-heading" className="sr-only">본문</h2>
          <div className="card p-4 sm:p-6"><MarkdownContent>{page.content}</MarkdownContent></div>
        </section>

        {page.terms.length > 0 && <section className="mt-6" aria-labelledby="wiki-terms-heading">
          <h2 id="wiki-terms-heading" className="label mb-2">연결된 용어</h2>
          <div className="flex flex-wrap gap-1.5">
            {page.terms.map((term) => <Link key={term.id} href={`/g/${term.slug}`} className="chip hover:border-brand/45 hover:text-brand">
              {term.title}
            </Link>)}
          </div>
        </section>}

        <footer className="mt-6 border-t border-line pt-4 text-xs text-ink-3">
          위키 문서는 검토·승인된 조직 맥락으로 AI 검색에 사용됩니다.
        </footer>
      </article>
    </AppShell>
  );
}
