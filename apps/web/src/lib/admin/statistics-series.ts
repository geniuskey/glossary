export interface DailyCount {
  day: string;
  count: number;
}

/**
 * /statistics는 비로그인에도 열려 있다(28c6064). 익명에게는 조직 규모(사용자 수·가입
 * 추이)와 초안만 담긴 도메인·분류 이름이 새지 않도록 집계 단계에서부터 갈라야 한다 —
 * 렌더에서만 숨기면 RSC payload로 값이 그대로 내려간다.
 */
export type StatisticsAudience = "public" | "member";

export interface DailyStatisticsPoint {
  date: string;
  termsCreated: number;
  revisions: number;
  cumulativeTerms: number;
  usersCreated?: number;
  cumulativeUsers?: number;
}

export interface GroupStatistics {
  name: string;
  total: number;
  active: number;
  draft?: number;
  withOwner: number;
  updated30d: number;
  stale90d: number;
  lastUpdatedAt: string | null;
}

export interface GroupStatisticsRow {
  name: string;
  total: number;
  active: number;
  draft: number;
  withOwner: number;
  updated30d: number;
  stale90d: number;
  lastUpdatedAt: Date | string | null;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function countMap(rows: readonly DailyCount[]): Map<string, number> {
  return new Map(rows.map((row) => [row.day, Number(row.count)]));
}

function numberOf(value: unknown): number {
  return Number(value ?? 0);
}

/** 비어 있는 날짜도 0으로 채우고 현재 총계에서 역산해 누적 추이를 만든다. */
export function buildDailyStatistics(input: {
  today: string;
  days: number;
  totalTerms: number;
  terms: readonly DailyCount[];
  revisions: readonly DailyCount[];
  totalUsers?: number;
  users?: readonly DailyCount[];
}): DailyStatisticsPoint[] {
  const termCounts = countMap(input.terms);
  const userCounts = input.users ? countMap(input.users) : null;
  const revisionCounts = countMap(input.revisions);
  const start = addDays(input.today, -(input.days - 1));
  const dates = Array.from({ length: input.days }, (_, index) => addDays(start, index));
  let cumulativeTerms = Math.max(0, input.totalTerms - dates.reduce((sum, day) => sum + (termCounts.get(day) ?? 0), 0));
  let cumulativeUsers = userCounts
    ? Math.max(0, (input.totalUsers ?? 0) - dates.reduce((sum, day) => sum + (userCounts.get(day) ?? 0), 0))
    : 0;

  return dates.map((date) => {
    const termsCreated = termCounts.get(date) ?? 0;
    cumulativeTerms += termsCreated;
    const point: DailyStatisticsPoint = {
      date,
      termsCreated,
      revisions: revisionCounts.get(date) ?? 0,
      cumulativeTerms,
    };
    if (!userCounts) return point;
    const usersCreated = userCounts.get(date) ?? 0;
    cumulativeUsers += usersCreated;
    return { ...point, usersCreated, cumulativeUsers };
  });
}

/**
 * 공개 집계는 SQL에서 이미 초안을 걸러 오지만, 초안만 있던 그룹이 0건 행으로 남거나
 * draft 키가 값 0으로라도 직렬화되면 "초안이 있다/없다"가 드러난다. 그래서 여기서 한 번
 * 더 잘라 둔다.
 */
export function normalizeGroups(rows: readonly GroupStatisticsRow[], audience: StatisticsAudience): GroupStatistics[] {
  return rows.flatMap((row) => {
    const active = numberOf(row.active);
    if (audience === "public" && active === 0) return [];
    const group: GroupStatistics = {
      name: row.name,
      total: audience === "public" ? active : numberOf(row.total),
      active,
      withOwner: numberOf(row.withOwner),
      updated30d: numberOf(row.updated30d),
      stale90d: numberOf(row.stale90d),
      lastUpdatedAt: row.lastUpdatedAt == null ? null : new Date(row.lastUpdatedAt).toISOString(),
    };
    if (audience === "member") group.draft = numberOf(row.draft);
    return [group];
  });
}
