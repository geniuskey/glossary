import Link from "next/link";
import type { GroupStatistics } from "@/lib/admin/statistics";
import { cx } from "@/lib/ui/format";

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function ratio(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function signal(row: GroupStatistics): { label: string; className: string } {
  const ownerRate = ratio(row.withOwner, row.total);
  const staleRate = ratio(row.stale90d, row.total);
  if (ownerRate >= 80 && staleRate < 20) return { label: "양호", className: "border-ok/35 bg-ok-soft text-ok" };
  if (ownerRate >= 60 && staleRate < 40) return { label: "관찰", className: "border-warn/35 bg-warn-soft text-warn" };
  return { label: "점검 필요", className: "border-danger/35 bg-danger-soft text-danger" };
}

export function GroupStatisticsTable({
  kind,
  rows,
}: {
  kind: "category" | "domain";
  rows: readonly GroupStatistics[];
}) {
  const title = kind === "category" ? "카테고리별 관리 현황" : "도메인별 관리 현황";
  const description = kind === "category"
    ? "카테고리를 조직 단위로 보고 담당 지정과 갱신 상태를 비교합니다."
    : "하나의 용어가 여러 도메인에 포함되면 각 도메인 집계에 한 번씩 포함됩니다.";

  return (
    <section className="mt-8" aria-labelledby={`${kind}-statistics-heading`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${kind}-statistics-heading`} className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">{description}</p>
        </div>
        <p className="text-[11px] text-ink-3">양호 기준: 담당 지정 80% 이상 · 90일 미갱신 20% 미만</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
              <th scope="col" className="px-4 py-3 font-medium">{kind === "category" ? "카테고리 / 조직" : "도메인"}</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">전체</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">공개</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">초안</th>
              <th scope="col" className="px-3 py-3 font-medium">담당 지정</th>
              <th scope="col" className="px-3 py-3 font-medium">30일 내 갱신</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">90일 미갱신</th>
              <th scope="col" className="px-3 py-3 font-medium">마지막 갱신</th>
              <th scope="col" className="px-4 py-3 font-medium">관리 신호</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const ownerRate = ratio(row.withOwner, row.total);
              const updatedRate = ratio(row.updated30d, row.total);
              const state = signal(row);
              return (
                <tr key={row.name} className="hover:bg-panel-2/55">
                  <th scope="row" className="max-w-64 px-4 py-3 font-medium text-ink">
                    {kind === "category" && row.name === "미분류" ? (
                      <span className="line-clamp-2">{row.name}</span>
                    ) : (
                      <Link href={{ pathname: "/sheet", query: { [kind]: row.name } }} className="link line-clamp-2">{row.name}</Link>
                    )}
                  </th>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{row.total.toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-ok">{row.active.toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-warn">{row.draft.toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-3"><Rate value={ownerRate} detail={`${row.withOwner}/${row.total}`} /></td>
                  <td className="px-3 py-3"><Rate value={updatedRate} detail={`${row.updated30d}/${row.total}`} /></td>
                  <td className={cx("px-3 py-3 text-right font-mono tabular-nums", row.stale90d > 0 ? "text-danger" : "text-ink-3")}>{row.stale90d.toLocaleString("ko-KR")}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-2">{row.lastUpdatedAt ? DATE_FORMAT.format(new Date(row.lastUpdatedAt)) : "—"}</td>
                  <td className="px-4 py-3"><span className={cx("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", state.className)}>{state.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-5 py-12 text-center text-sm text-ink-2">집계할 데이터가 없습니다.</p>}
      </div>
    </section>
  );
}

function Rate({ value, detail }: { value: number; detail: string }) {
  return (
    <div className="min-w-28" title={detail}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>{value}%</span><span className="font-mono">{detail}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-brand" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
