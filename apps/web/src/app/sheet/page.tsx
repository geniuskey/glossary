import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermsGrid } from "@/components/terms-grid";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TERM_STATUS_LABEL, TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { SORT_KEYS, type SortDir, type SortKey } from "@/lib/terms/grid";
import {
  activeFilters,
  buildFilterHref,
  buildPageHref,
  buildSortDirHref,
  buildSortHref,
  hiddenSearchFields,
  paginationInfo,
  parseListParams,
} from "@/lib/terms/list-params";
import { listTermRows, termFacets } from "@/lib/terms/query";
import { cx, withCount } from "@/lib/ui/format";

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

const FILTER_LABEL: Record<string, string> = { q: "검색", type: "종류", domain: "도메인", status: "상태" };

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

  const [{ items, total }, facets] = await Promise.all([
    listTermRows({
      q: parsed.q,
      termType: parsed.type,
      domain: parsed.domain,
      status: parsed.status,
      sort: parsed.sort,
      dir: parsed.dir,
      page: parsed.page,
      pageSize: PAGE_SIZE,
    }),
    termFacets(),
  ]);

  const pagination = paginationInfo(parsed.page, total, PAGE_SIZE);
  const filters = activeFilters(parsed);

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

  return (
    <AppShell user={user} current="sheet" wide>
      <header className="shrink-0 border-b border-line bg-panel/70 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">시트</h1>
          <p className="text-xs text-ink-3">
            개념 <span className="font-medium text-ink-2">{total}</span>개 · 셀을 눌러 바로 고치면 그대로 저장됩니다
          </p>
          <Link href="/new" className="btn-primary btn-sm ml-auto">
            자세히 추가
          </Link>
        </div>

        {/* R94: q는 이 폼 자신의 보이는 입력이라 hidden으로 다시 싣지 않는다.
            나머지 필터와 정렬은 hidden input으로 실어야 검색 제출 시 사라지지
            않는다(GET 폼은 자기 안의 input만 querystring으로 직렬화한다). */}
        <form method="get" className="mt-3 flex flex-wrap items-center gap-1.5">
          <input
            name="q"
            defaultValue={parsed.q ?? ""}
            placeholder="용어 · 약어 · 별칭 검색"
            className="field h-8 w-56 py-0"
          />
          {/* 숫자는 사전 전체 기준이다(termFacets는 현재 필터를 반영하지 않는다) —
              "전체" 항목에 그 전체 수를 같이 적어야 각 항목의 수가 부분으로 읽힌다.
              머리글의 "개념 N개"는 검색 결과 수라 이 값과 다를 수 있다. */}
          <FilterSelect
            name="type"
            value={parsed.type}
            placeholder={withCount("종류 전체", facets.total)}
            options={facets.types.map((f) => ({ value: f.value, label: withCount(TERM_TYPE_LABEL[f.value], f.count) }))}
          />
          <FilterSelect
            name="status"
            value={parsed.status}
            placeholder={withCount("상태 전체", facets.total)}
            options={facets.statuses.map((f) => ({
              value: f.value,
              label: withCount(TERM_STATUS_LABEL[f.value], f.count),
            }))}
          />
          <FilterSelect
            name="domain"
            value={parsed.domain}
            placeholder={withCount("도메인 전체", facets.total)}
            options={facets.domains.map((f) => ({ value: f.value, label: withCount(f.value, f.count) }))}
          />
          {hiddenSearchFields(parsed)
            .filter((f) => f.name === "sort" || f.name === "dir")
            .map((f) => (
              <input key={f.name} type="hidden" name={f.name} value={f.value} />
            ))}
          <button type="submit" className="btn-ghost btn-sm h-8">
            적용
          </button>

          {filters.length > 0 && (
            <span className="ml-1 flex flex-wrap items-center gap-1">
              {filters.map((f) => (
                <Link key={f.name} href={buildFilterHref(parsed, f.name)} className="chip chip-on" title="이 필터 지우기">
                  {FILTER_LABEL[f.name]}: {f.value}
                  <span aria-hidden>×</span>
                </Link>
              ))}
            </span>
          )}
        </form>
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
        knownDomains={facets.domains.map((d) => d.value)}
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

function FilterSelect({
  name,
  value,
  placeholder,
  options,
}: {
  name: string;
  value: string | undefined;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    // optgroup은 고를 수 없는 머리글로 그려진다 — 숫자가 무엇을 센 것인지
    // 툴팁이 아니라 숫자 바로 위에서 말해 준다. JS 없이 동작하는 GET 폼이라
    // 커스텀 드롭다운으로 바꾸지 않고 네이티브 select 안에서 푼다.
    <select name={name} defaultValue={value ?? ""} className="field h-8 w-auto py-0 text-xs">
      <option value="">{placeholder}</option>
      <optgroup label="사전 전체의 개념 수">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
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
