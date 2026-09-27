import Link from "next/link";
import { WIKI_PAGE_SIZE_OPTIONS } from "@/lib/wiki/list-params";

interface WikiPage {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  domain: string[];
  tags: string[];
  revision: number;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  terms: Array<{ slug: string; title: string }>;
}

const STATUS_LABEL = { draft: "초안", published: "공개", archived: "보관" } as const;

function pageHref(page: number, query: string, pageSize: number, tag: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (tag) params.set("tag", tag);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return "/w?" + params.toString();
}

export function WikiIndexPanel({
  initialPages,
  query,
  tag,
  tagOptions,
  page,
  pageSize,
  total,
  totalPages,
  overallTotal,
}: {
  initialPages: WikiPage[];
  query: string;
  tag: string;
  tagOptions: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  overallTotal: number;
}) {
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">업무 문서</h1>
          <span aria-label={"보관 문서 포함 전체 위키 " + overallTotal.toLocaleString("ko-KR") + "개"} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold tabular-nums text-brand">
            전체 {overallTotal.toLocaleString("ko-KR")}개
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-ink-2">용어와 관련된 원칙·절차·플레이북을 정리합니다. 보관 문서도 전체 수에 포함됩니다.</p>
      </div>
      <Link href="/w/new" className="btn-primary">새 위키 문서</Link>
    </header>

    <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
      <form action="/w" method="get" role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <label htmlFor="wiki-search" className="sr-only">위키 문서 검색</label>
        <input
          id="wiki-search"
          className="field min-w-0 flex-1"
          type="search"
          name="q"
          maxLength={200}
          defaultValue={query}
          placeholder="제목·요약·본문·태그 검색"
        />
        <input type="hidden" name="pageSize" value={pageSize} />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button className="btn-primary" type="submit">검색</button>
        {query && <Link className="btn-quiet" href={pageHref(1, "", pageSize, tag)}>검색 지우기</Link>}
      </form>
      <form action="/w" method="get" className="flex items-center gap-2">
        {query && <input type="hidden" name="q" value={query} />}
        <label htmlFor="wiki-tag-filter" className="whitespace-nowrap text-xs text-ink-2">태그</label>
        <select id="wiki-tag-filter" className="field w-auto py-2 text-sm" name="tag" defaultValue={tag}>
          <option value="">전체</option>
          {tagOptions.map((option) => <option key={option} value={option}>#{option}</option>)}
        </select>
        <label htmlFor="wiki-page-size" className="whitespace-nowrap text-xs text-ink-2">페이지당</label>
        <select id="wiki-page-size" className="field w-auto py-2 text-sm" name="pageSize" defaultValue={String(pageSize)}>
          {WIKI_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}개</option>)}
        </select>
        <button className="btn-quiet btn-sm" type="submit">적용</button>
        {tag && <Link className="btn-quiet btn-sm" href={pageHref(1, query, pageSize, "")}>태그 해제</Link>}
      </form>
    </div>

    <section aria-label="위키 문서 목록" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-sm text-ink-2">
          {query || tag
            ? <><span className="font-semibold text-ink">{total.toLocaleString("ko-KR")}개</span> {query ? "검색 결과" : "문서"}{tag && <span className="text-ink-3"> · #{tag}</span>} <span className="text-ink-3">(보관 문서 제외)</span></>
            : <><span className="font-semibold text-ink">{total.toLocaleString("ko-KR")}개</span> 문서 <span className="text-ink-3">(보관 문서 제외 · 최근 수정 순)</span></>}
        </p>
        <p className="text-xs tabular-nums text-ink-3">{page} / {totalPages}페이지</p>
      </div>

      {initialPages.length > 0 ? <ul className="divide-y divide-line">
        {initialPages.map((item) => <li key={item.id}>
          <Link href={"/w/" + item.slug} className="group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-panel-2/70 sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="break-words text-sm font-semibold text-ink group-hover:text-brand">{item.title}</h2>
                <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + (item.status === "published" ? "bg-ok-soft text-ok" : item.status === "archived" ? "bg-panel-2 text-ink-3" : "bg-warn-soft text-warn")}>{STATUS_LABEL[item.status]}</span>
              </div>
              {item.summary && <p className="mt-1 line-clamp-1 text-sm leading-5 text-ink-2">{item.summary}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span>리비전 {item.revision}</span>
                <span>연결 용어 {item.terms.length}개</span>
                {item.domain.map((domain) => <span key={domain} className="rounded bg-panel-2 px-1.5 py-0.5">{domain}</span>)}
                {item.tags.map((itemTag) => <span key={itemTag} className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">#{itemTag}</span>)}
              </div>
            </div>
            <time className="shrink-0 text-xs text-ink-3 sm:pt-1" dateTime={item.updatedAt}>
              {new Date(item.updatedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}
            </time>
          </Link>
        </li>)}
      </ul> : <div className="px-5 py-12 text-center">
        <p className="text-sm text-ink-3">{query || tag ? "조건에 맞는 위키 문서가 없습니다." : "아직 위키 문서가 없습니다."}</p>
        {query || tag ? <Link href={pageHref(1, "", pageSize, "")} className="btn-quiet mt-4">전체 목록 보기</Link> : <Link href="/w/new" className="btn-primary mt-4 inline-flex">첫 문서 만들기</Link>}
      </div>}

      {totalPages > 1 && <nav aria-label="위키 문서 페이지" className="flex items-center justify-center gap-3 border-t border-line px-4 py-3 text-xs">
        {page > 1 && <Link href={pageHref(page - 1, query, pageSize, tag)} className="btn-quiet btn-sm">이전</Link>}
        <span className="tabular-nums">{page} / {totalPages}페이지 · 검색 결과 {total.toLocaleString("ko-KR")}개</span>
        {page < totalPages && <Link href={pageHref(page + 1, query, pageSize, tag)} className="btn-quiet btn-sm">다음</Link>}
      </nav>}
    </section>
  </div>;
}
