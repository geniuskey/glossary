import type { DailyStatisticsPoint } from "@/lib/admin/statistics-series";
import { HelpTip } from "@/components/help-tip";

const WIDTH = 720;
const HEIGHT = 230;
const LEFT = 44;
const RIGHT = 14;
const TOP = 18;
const BOTTOM = 34;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function tickIndexes(length: number): number[] {
  if (length <= 1) return [0];
  return [...new Set([0, Math.round((length - 1) / 3), Math.round(((length - 1) * 2) / 3), length - 1])];
}

function yTicks(max: number): number[] {
  return [0, 0.5, 1].map((ratio) => Math.round(max * ratio));
}

export function DailyGrowthChart({ data }: { data: readonly DailyStatisticsPoint[] }) {
  const max = Math.max(1, ...data.flatMap((point) => [point.termsCreated, point.usersCreated]));
  const groupWidth = PLOT_WIDTH / Math.max(1, data.length);
  const barWidth = Math.max(1, Math.min(7, groupWidth * 0.34));

  return (
    <ChartFrame title="일별 신규 등록" description="날짜별 신규 용어와 신규 사용자를 비교합니다." legend={[
      { label: "신규 용어", className: "bg-brand" },
      { label: "신규 사용자", className: "bg-accent" },
    ]}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="daily-growth-title daily-growth-desc" className="h-auto w-full min-w-[560px]">
        <title id="daily-growth-title">일별 신규 용어 및 사용자</title>
        <desc id="daily-growth-desc">선택 기간 동안 날짜별로 등록된 용어와 사용자의 수를 막대로 표시합니다.</desc>
        <Grid max={max} />
        {data.map((point, index) => {
          const center = LEFT + groupWidth * (index + 0.5);
          const termHeight = (point.termsCreated / max) * PLOT_HEIGHT;
          const userHeight = (point.usersCreated / max) * PLOT_HEIGHT;
          return (
            <g key={point.date}>
              <rect x={center - barWidth - 1} y={TOP + PLOT_HEIGHT - termHeight} width={barWidth} height={termHeight} rx="1.5" className="fill-brand">
                <title>{`${point.date} 신규 용어 ${point.termsCreated}개`}</title>
              </rect>
              <rect x={center + 1} y={TOP + PLOT_HEIGHT - userHeight} width={barWidth} height={userHeight} rx="1.5" className="fill-accent">
                <title>{`${point.date} 신규 사용자 ${point.usersCreated}명`}</title>
              </rect>
            </g>
          );
        })}
        <DateTicks data={data} />
      </svg>
    </ChartFrame>
  );
}

export function RevisionActivityChart({ data }: { data: readonly DailyStatisticsPoint[] }) {
  const max = Math.max(1, ...data.map((point) => point.revisions));
  const barSpace = PLOT_WIDTH / Math.max(1, data.length);
  const barWidth = Math.max(1, Math.min(12, barSpace * 0.68));

  return (
    <ChartFrame title="일별 편집 활동" description="리비전 생성 건수로 실제 용어 관리 활동을 확인합니다." legend={[
      { label: "편집 리비전", className: "bg-ok" },
    ]}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="revision-title revision-desc" className="h-auto w-full min-w-[560px]">
        <title id="revision-title">일별 용어 편집 활동</title>
        <desc id="revision-desc">선택 기간 동안 날짜별로 생성된 용어 리비전 수를 막대로 표시합니다.</desc>
        <Grid max={max} />
        {data.map((point, index) => {
          const height = (point.revisions / max) * PLOT_HEIGHT;
          const x = LEFT + barSpace * (index + 0.5) - barWidth / 2;
          return (
            <rect key={point.date} x={x} y={TOP + PLOT_HEIGHT - height} width={barWidth} height={height} rx="1.5" className="fill-ok">
              <title>{`${point.date} 편집 ${point.revisions}건`}</title>
            </rect>
          );
        })}
        <DateTicks data={data} />
      </svg>
    </ChartFrame>
  );
}

export function CumulativeChart({
  data,
  value,
  title,
  unit,
}: {
  data: readonly DailyStatisticsPoint[];
  value: "cumulativeTerms" | "cumulativeUsers";
  title: string;
  unit: string;
}) {
  const values = data.map((point) => point[value]);
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const max = Math.max(...values, 1);
  const min = rawMin > 0 ? Math.max(0, rawMin - Math.max(1, (max - rawMin) * 0.1)) : 0;
  const range = Math.max(1, max - min);
  const points = data.map((point, index) => {
    const x = LEFT + (index / Math.max(1, data.length - 1)) * PLOT_WIDTH;
    const y = TOP + PLOT_HEIGHT - ((point[value] - min) / range) * PLOT_HEIGHT;
    return { x, y, point };
  });
  const path = points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = points.length > 0
    ? `${path} L${points.at(-1)!.x},${TOP + PLOT_HEIGHT} L${points[0]!.x},${TOP + PLOT_HEIGHT} Z`
    : "";

  return (
    <ChartFrame title={title} description={`기간 마지막 ${max.toLocaleString("ko-KR")}${unit}`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title} className="h-auto w-full min-w-[500px] text-brand">
        {[min, min + range / 2, max].map((tick, index) => {
          const y = TOP + PLOT_HEIGHT - index * (PLOT_HEIGHT / 2);
          return (
            <g key={index}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} className="stroke-line" strokeWidth="1" />
              <text x={LEFT - 7} y={y + 4} textAnchor="end" className="fill-ink-3 text-[10px]">{Math.round(tick).toLocaleString("ko-KR")}</text>
            </g>
          );
        })}
        <path d={area} className="fill-brand/10" />
        <path d={path} fill="none" className="stroke-brand" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map(({ x, y, point }, index) => (
          <circle key={point.date} cx={x} cy={y} r={tickIndexes(points.length).includes(index) ? 3 : 1.5} className="fill-panel stroke-brand" strokeWidth="1.5">
            <title>{`${point.date} ${point[value].toLocaleString("ko-KR")}${unit}`}</title>
          </circle>
        ))}
        <DateTicks data={data} />
      </svg>
    </ChartFrame>
  );
}

function ChartFrame({
  title,
  description,
  legend = [],
  children,
}: {
  title: string;
  description: string;
  legend?: Array<{ label: string; className: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="card min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <HelpTip text={description} />
        </div>
        {legend.length > 0 && (
          <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
            {legend.map((item) => <span key={item.label} className="inline-flex items-center gap-1.5"><i className={`h-2 w-2 rounded-sm ${item.className}`} />{item.label}</span>)}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Grid({ max }: { max: number }) {
  return yTicks(max).map((tick, index) => {
    const y = TOP + PLOT_HEIGHT - index * (PLOT_HEIGHT / 2);
    return (
      <g key={index}>
        <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} className="stroke-line" strokeWidth="1" />
        <text x={LEFT - 7} y={y + 4} textAnchor="end" className="fill-ink-3 text-[10px]">{tick.toLocaleString("ko-KR")}</text>
      </g>
    );
  });
}

function DateTicks({ data }: { data: readonly DailyStatisticsPoint[] }) {
  return tickIndexes(data.length).map((index) => {
    const point = data[index];
    if (!point) return null;
    const x = LEFT + (index / Math.max(1, data.length - 1)) * PLOT_WIDTH;
    return <text key={point.date} x={x} y={HEIGHT - 9} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} className="fill-ink-3 text-[10px]">{shortDate(point.date)}</text>;
  });
}
