export interface DailyCount {
  day: string;
  count: number;
}

export interface DailyStatisticsPoint {
  date: string;
  termsCreated: number;
  usersCreated: number;
  revisions: number;
  cumulativeTerms: number;
  cumulativeUsers: number;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function countMap(rows: readonly DailyCount[]): Map<string, number> {
  return new Map(rows.map((row) => [row.day, Number(row.count)]));
}

/** 비어 있는 날짜도 0으로 채우고 현재 총계에서 역산해 누적 추이를 만든다. */
export function buildDailyStatistics(input: {
  today: string;
  days: number;
  totalTerms: number;
  totalUsers: number;
  terms: readonly DailyCount[];
  users: readonly DailyCount[];
  revisions: readonly DailyCount[];
}): DailyStatisticsPoint[] {
  const termCounts = countMap(input.terms);
  const userCounts = countMap(input.users);
  const revisionCounts = countMap(input.revisions);
  const start = addDays(input.today, -(input.days - 1));
  const dates = Array.from({ length: input.days }, (_, index) => addDays(start, index));
  let cumulativeTerms = Math.max(0, input.totalTerms - dates.reduce((sum, day) => sum + (termCounts.get(day) ?? 0), 0));
  let cumulativeUsers = Math.max(0, input.totalUsers - dates.reduce((sum, day) => sum + (userCounts.get(day) ?? 0), 0));

  return dates.map((date) => {
    const termsCreated = termCounts.get(date) ?? 0;
    const usersCreated = userCounts.get(date) ?? 0;
    cumulativeTerms += termsCreated;
    cumulativeUsers += usersCreated;
    return {
      date,
      termsCreated,
      usersCreated,
      revisions: revisionCounts.get(date) ?? 0,
      cumulativeTerms,
      cumulativeUsers,
    };
  });
}
