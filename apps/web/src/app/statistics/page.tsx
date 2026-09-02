import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { CumulativeChart, DailyGrowthChart, RevisionActivityChart } from "@/components/statistics-charts";
import { getPlatformStatistics } from "@/lib/admin/statistics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listBusinessCategories } from "@/lib/terms/categories";
import { GroupStatisticsTable } from "./group-statistics-table";

export const metadata = { title: "플랫폼 통계" };
export const dynamic = "force-dynamic";

const PERIODS = [30, 90, 180] as const;

function periodOf(value: string | string[] | undefined): 30 | 90 | 180 {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return PERIODS.includes(parsed as 30 | 90 | 180) ? parsed as 30 | 90 | 180 : 30;
}

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const period = periodOf((await searchParams).days);
  const [statistics, categories] = await Promise.all([getPlatformStatistics(period), listBusinessCategories()]);
  const categoryLabels = Object.fromEntries(categories.map((category) => [category.key, category.label]));
  const activeRate = statistics.totals.terms > 0
    ? Math.round((statistics.totals.activeTerms / statistics.totals.terms) * 100)
    : 0;

  return (
    <AppShell user={user} title="플랫폼 통계" current="statistics" wide>
      <header className="shrink-0 border-b border-line bg-panel/70 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand lg:hidden">PLATFORM HEALTH</p>
            <p className="mt-1 text-xl font-semibold lg:hidden">플랫폼 통계</p>
          </div>
          <nav aria-label="통계 기간" className="flex rounded-lg border border-line bg-panel p-1">
            {PERIODS.map((days) => (
              <Link
                key={days}
                href={{ pathname: "/statistics", query: { days } }}
                aria-current={days === period ? "page" : undefined}
                className={days === period ? "rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-on" : "rounded-md px-3 py-1.5 text-xs text-ink-2 hover:bg-panel-2"}
              >
                {days}일
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="플랫폼 요약">
          <StatCard label="전체 용어" value={statistics.totals.terms} sub={`공개 ${activeRate}%`} />
          <StatCard label="전체 사용자" value={statistics.totals.users} sub={`최근 30일 +${statistics.totals.users30d}`} />
          <StatCard label="최근 30일 신규 용어" value={statistics.totals.terms30d} help="용어의 생성일을 기준으로 집계합니다." />
          <StatCard label="최근 30일 편집" value={statistics.totals.revisions30d} help="새로 생성된 리비전 수를 기준으로 집계합니다." />
          <StatCard label="카테고리" value={statistics.categories.length} help="미분류 항목을 포함합니다." />
          <StatCard label="도메인" value={statistics.domains.length} help="하나의 용어가 여러 도메인에 포함될 수 있습니다." />
        </section>

        <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-2">
          <DailyGrowthChart data={statistics.daily} />
          <RevisionActivityChart data={statistics.daily} />
          <CumulativeChart data={statistics.daily} value="cumulativeTerms" title={`누적 용어 · ${period}일`} unit="개" />
          <CumulativeChart data={statistics.daily} value="cumulativeUsers" title={`누적 사용자 · ${period}일`} unit="명" />
        </div>

        <GroupStatisticsTable kind="category" rows={statistics.categories} categoryLabels={categoryLabels} />
        <GroupStatisticsTable kind="domain" rows={statistics.domains} />

        <footer className="mt-6 flex items-center gap-1.5 border-t border-line pt-4 text-xs text-ink-3">
          <span>마지막 집계 {new Date(statistics.generatedAt).toLocaleString("ko-KR", { timeZone: statistics.timeZone })}</span>
          <HelpTip text={`날짜는 ${statistics.timeZone} 기준입니다. 성장 추이는 현재 남아 있는 용어·사용자의 생성일, 편집 활동은 리비전 생성 건수를 기준으로 집계합니다.`} />
        </footer>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, help }: { label: string; value: number; sub?: string; help?: string }) {
  return (
    <div className="card px-4 py-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3">{label}{help && <HelpTip text={help} />}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink">{value.toLocaleString("ko-KR")}</p>
      {sub && <p className="mt-1 text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}
