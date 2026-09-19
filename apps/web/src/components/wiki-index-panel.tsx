"use client";

import Link from "next/link";

interface WikiPage {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  domain: string[];
  revision: number;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  terms: Array<{ slug: string; title: string }>;
}

const STATUS_LABEL = { draft: "초안", published: "공개", archived: "보관" } as const;

export function WikiIndexPanel({ initialPages }: { initialPages: WikiPage[] }) {
  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Workspace knowledge</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">위키 지식 창고</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">용어를 둘러싼 업무 원칙·프로세스·플레이북을 정리합니다. 공개된 문서만 AI가 공식 맥락으로 검색하고, 초안은 사람이 검토할 때까지 분리합니다.</p>
      </div>
      <Link href="/w/new" className="btn-primary">새 위키 문서</Link>
    </header>

    <div className="grid gap-3 sm:grid-cols-2">
      {initialPages.map((page) => <Link key={page.id} href={`/w/${page.slug}`} className="group card block p-4 transition-colors hover:border-brand/40 hover:bg-brand-soft/15">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold text-ink group-hover:text-brand">{page.title}</h2>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${page.status === "published" ? "bg-ok-soft text-ok" : page.status === "archived" ? "bg-panel-2 text-ink-3" : "bg-warn-soft text-warn"}`}>{STATUS_LABEL[page.status]}</span>
        </div>
        {page.summary && <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-2">{page.summary}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
          {page.terms.slice(0, 3).map((term) => <span key={term.slug} className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">{term.title}</span>)}
          {page.domain.map((domain) => <span key={domain} className="rounded bg-panel-2 px-1.5 py-0.5">{domain}</span>)}
          <span className="ml-auto">리비전 {page.revision}</span>
        </div>
      </Link>)}
    </div>
    {initialPages.length === 0 && <div className="card p-10 text-center"><p className="text-sm text-ink-3">아직 위키 문서가 없습니다.</p><Link href="/w/new" className="btn-primary mt-4 inline-flex">첫 문서 만들기</Link></div>}
  </div>;
}
