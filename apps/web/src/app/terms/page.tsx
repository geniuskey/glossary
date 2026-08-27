import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DomainBadges, StatusBadge } from "@/components/term-badges";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildPageHref, hiddenSearchFields, paginationInfo, parseListParams } from "@/lib/terms/list-params";
import { listTerms } from "@/lib/terms/query";

const PAGE_SIZE = 20;

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

  const { items, total } = await listTerms({
    q: parsed.q,
    termType: parsed.type,
    domain: parsed.domain,
    status: parsed.status,
    page: parsed.page,
    pageSize: PAGE_SIZE,
  });
  const pagination = paginationInfo(parsed.page, total, PAGE_SIZE);

  return (
    <AppShell user={user}>
      {/* R94: q는 이 폼 자신의 보이는 입력이라 hidden으로 다시 싣지 않는다.
          type/domain/status는 hidden input으로 실어야 검색 제출 시 사라지지
          않는다(GET 폼은 자기 안의 input만 querystring으로 직렬화한다). */}
      <form className="mb-6 flex gap-2" method="get">
        <input
          name="q"
          defaultValue={parsed.q ?? ""}
          placeholder="용어, 약어, 별칭으로 검색"
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
        {hiddenSearchFields(parsed).map((f) => (
          <input key={f.name} type="hidden" name={f.name} value={f.value} />
        ))}
        <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-white">
          검색
        </button>
      </form>

      <p className="mb-3 text-sm text-slate-500">{total}개</p>

      <ul className="divide-y divide-slate-200">
        {items.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-3">
            <div>
              <Link href={`/terms/${t.slug}`} className="font-medium hover:underline">
                {t.nameEn ?? t.nameKo}
              </Link>
              {t.nameEn && t.nameKo && <span className="ml-2 text-sm text-slate-500">{t.nameKo}</span>}
            </div>
            <div className="flex items-center gap-2">
              <DomainBadges domain={t.domain} />
              <StatusBadge status={t.status} />
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && <p className="py-8 text-slate-500">결과가 없습니다.</p>}

      {/* R93: 21번째 용어부터는 이 링크 없이는 UI로 영원히 도달 불가능했다.
          현재 필터를 전부 보존하면서 page만 바꾼다(buildPageHref). */}
      {pagination.totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {pagination.hasPrev ? (
            <Link href={buildPageHref(parsed, parsed.page - 1)} className="text-slate-600 hover:text-slate-900">
              이전
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            {pagination.page} / {pagination.totalPages}
          </span>
          {pagination.hasNext ? (
            <Link href={buildPageHref(parsed, parsed.page + 1)} className="text-slate-600 hover:text-slate-900">
              다음
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AppShell>
  );
}
