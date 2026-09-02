import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SheetShare } from "@/components/sheet-share";
import { SheetFilterBar, type SheetFilter } from "@/components/sheet-filter-bar";
import { TermsGrid } from "@/components/terms-grid";
import { getCurrentUser } from "@/lib/auth/current-user";
import { embedBaseQuery } from "@/lib/embed/sheet-share";
import { businessCategoryLabel, TERM_STATUS_LABEL, TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { businessCategoryExists } from "@/lib/terms/categories";
import { listDomains } from "@/lib/terms/domains";
import { SORT_KEYS, type SortDir, type SortKey } from "@/lib/terms/grid";
import {
  buildFilterHref,
  buildPageHref,
  buildSortDirHref,
  buildSortHref,
  paginationInfo,
  parseListParams,
} from "@/lib/terms/list-params";
import { listTermRows, termFacets } from "@/lib/terms/query";
import { cx } from "@/lib/ui/format";

export const metadata = { title: "시트" };

// 표는 한 화면에서 훑는 물건이라 20줄은 너무 적다. 그렇다고 무한정 늘리면
// 첫 페인트가 느려지므로 한 화면 스크롤 두어 번 분량으로 잡는다.
const PAGE_SIZE = 50;

// 열 머리글을 처음 눌렀을 때의 방향. 이름은 사전처럼 ㄱ→ㅎ이 자연스럽고,
// 수정 시각만 최신이 위로 오는 게 자연스럽다.
const SORT_FALLBACK_DIR: Record<SortKey, SortDir> = {
  updatedAt: "desc",
  nameEn: "asc",
  nameKo: "asc",
  slug: "asc",
  termType: "asc",
  status: "asc",
};

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // R90: 좁히기(알 수 없는 enum -> undefined, page 클램프)는 list-params.ts의
  // 순수 함수가 맡는다 — API 라우트의 parseEnumParam/parsePageParam(R91)과
  // 달리 여기서는 잘못된 값을 400이 아니라 조용히 "지정 안 함"으로 무시한다.
  const raw = await searchParams;
  const parsed = parseListParams(raw);
  // v0.1.x의 자유 입력 category 링크는 0013에서 topic으로 보존됐다. 관리 목록에
  // 없는 category만 옛 링크로 보고 topic으로 넘겨, 새 사용자 정의 key와 충돌하지 않는다.
  if (parsed.category && !(await businessCategoryExists(parsed.category))) {
    parsed.topic ??= parsed.category;
    parsed.category = undefined;
  }

  const [{ items, total }, facets, domainOptions] = await Promise.all([
    listTermRows({
      q: parsed.q,
      termType: parsed.type,
      domain: parsed.domain,
      category: parsed.category,
      topic: parsed.topic,
      status: parsed.status,
      sort: parsed.sort,
      dir: parsed.dir,
      page: parsed.page,
      pageSize: PAGE_SIZE,
    }),
    termFacets(),
    listDomains(),
  ]);
  const knownDomains = [...new Set([
    ...domainOptions.map((domain) => domain.label),
    ...facets.domains.map((domain) => domain.value),
  ])];

  const pagination = paginationInfo(parsed.page, total, PAGE_SIZE);
  const filters: SheetFilter[] = [
    {
      name: "type",
      label: "Type",
      value: parsed.type,
      valueLabel: parsed.type ? TERM_TYPE_LABEL[parsed.type] : undefined,
      options: facets.types.map((facet) => ({ value: facet.value, label: TERM_TYPE_LABEL[facet.value], count: facet.count })),
    },
    {
      name: "status",
      label: "상태",
      value: parsed.status,
      valueLabel: parsed.status ? TERM_STATUS_LABEL[parsed.status] : undefined,
      options: facets.statuses.map((facet) => ({ value: facet.value, label: TERM_STATUS_LABEL[facet.value], count: facet.count })),
    },
    {
      name: "domain",
      label: "도메인",
      value: parsed.domain,
      valueLabel: parsed.domain,
      options: facets.domains.map((facet) => ({ value: facet.value, label: facet.value, count: facet.count })),
    },
    {
      name: "category",
      label: "업무 분류",
      value: parsed.category,
      valueLabel: parsed.category ? businessCategoryLabel(parsed.category, facets.categories.find((facet) => facet.value === parsed.category)?.label) : undefined,
      options: facets.categories.map((facet) => ({ value: facet.value, label: facet.label, count: facet.count })),
    },
    {
      name: "topic",
      label: "주제",
      value: parsed.topic,
      valueLabel: parsed.topic,
      options: facets.topics.map((facet) => ({ value: facet.value, label: facet.value, count: facet.count })),
    },
  ];

  // 정렬 링크는 서버에서 만든다 — buildSortHref가 있는 list-params.ts는
  // @grossary/db를 import하므로 Client Component가 직접 부를 수 없다(R114).
  const sortHrefs = Object.fromEntries(
    SORT_KEYS.map((key) => [key, buildSortHref(parsed, key, SORT_FALLBACK_DIR[key])]),
  ) as Record<SortKey, string>;

  // 머리글 우클릭 메뉴는 방향을 눌러 고르므로 토글 링크와 별개로 두 방향을 다 넘긴다.
  const sortDirHrefs = Object.fromEntries(
    SORT_KEYS.map((key) => [
      key,
      { asc: buildSortDirHref(parsed, key, "asc"), desc: buildSortDirHref(parsed, key, "desc") },
    ]),
  ) as Record<SortKey, { asc: string; desc: string }>;

  const activeGridFilters = [
    { key: "q" as const, label: "검색", value: parsed.q },
    ...filters.map((filter) => ({
      key: filter.name,
      label: filter.label,
      value: filter.value ? (filter.valueLabel ?? filter.value) : undefined,
    })),
  ].flatMap((filter) => filter.value
    ? [{ ...filter, value: filter.value, href: buildFilterHref(parsed, filter.key) }]
    : []);

  return (
    <AppShell user={user} title="시트" current="sheet" wide>
      <header className="relative z-[60] shrink-0 border-b border-line bg-panel/70 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
          <p className="text-lg font-semibold tracking-tight lg:hidden">시트</p>
          <SheetFilterBar query={parsed.q ?? ""} filters={filters} />
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {facets.needsContribution > 0 && (
              <Link href="/contribute" className="chip border-warn/30 bg-warn-soft text-warn">
                정리 필요 {facets.needsContribution}
              </Link>
            )}
            <SheetShare
              baseQuery={embedBaseQuery(parsed)}
              filters={{
                q: parsed.q ?? "",
                type: parsed.type ?? "",
                status: parsed.status === "draft" ? "" : parsed.status ?? "",
                domain: parsed.domain ?? "",
                category: parsed.category ?? "",
                topic: parsed.topic ?? "",
              }}
              domains={facets.domains.map((facet) => facet.value)}
              categories={facets.categories.map((facet) => ({ key: facet.value, label: facet.label }))}
              topics={facets.topics.map((facet) => facet.value)}
            />
          </span>
        </div>
      </header>

      <TermsGrid
        rows={items}
        viewerName={user.name || user.email}
        canDelete={user.role === "admin"}
        rowOffset={(parsed.page - 1) * PAGE_SIZE}
        sortHrefs={sortHrefs}
        sortDirHrefs={sortDirHrefs}
        sortState={{ key: parsed.sort ?? "updatedAt", dir: parsed.dir ?? "desc" }}
        query={parsed.q}
        // 도메인 후보는 이 페이지의 50줄이 아니라 사전 전체에서 뽑는다 — 표에서
        // 도메인을 새로 칠 때 이미 쓰던 값이 후보에 없으면 오타가 새 도메인이 된다.
        knownDomains={knownDomains}
        categoryOptions={facets.categories.map((category) => ({ key: category.value, label: category.label }))}
        activeFilters={activeGridFilters}
      />

      {/* R93: 51번째 용어부터는 이 링크 없이는 UI로 영원히 도달 불가능하다.
          현재 필터와 정렬을 전부 보존하면서 page만 바꾼다. */}
      <nav className="flex shrink-0 items-center justify-center gap-3 border-t border-line bg-panel px-4 py-2 text-xs">
        <PageLink href={buildPageHref(parsed, parsed.page - 1)} enabled={pagination.hasPrev}>
          이전
        </PageLink>
        <span className="text-ink-3">
          {pagination.page} / {Math.max(1, pagination.totalPages)}
        </span>
        <PageLink href={buildPageHref(parsed, parsed.page + 1)} enabled={pagination.hasNext}>
          다음
        </PageLink>
      </nav>
    </AppShell>
  );
}

function PageLink({ href, enabled, children }: { href: string; enabled: boolean; children: React.ReactNode }) {
  if (!enabled) return <span className="text-ink-3/50">{children}</span>;
  return (
    <Link href={href} className={cx("text-ink-2 hover:text-ink")}>
      {children}
    </Link>
  );
}
