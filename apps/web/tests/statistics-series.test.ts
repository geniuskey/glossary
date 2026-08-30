import { expect, test } from "vitest";
import { buildDailyStatistics } from "../src/lib/admin/statistics-series.js";

test("통계 기간의 빈 날짜를 채우고 용어·사용자 누적값을 계산한다", () => {
  expect(buildDailyStatistics({
    today: "2026-08-30",
    days: 3,
    totalTerms: 12,
    totalUsers: 5,
    terms: [{ day: "2026-08-28", count: 2 }, { day: "2026-08-30", count: 1 }],
    users: [{ day: "2026-08-29", count: 1 }],
    revisions: [{ day: "2026-08-30", count: 4 }],
  })).toEqual([
    { date: "2026-08-28", termsCreated: 2, usersCreated: 0, revisions: 0, cumulativeTerms: 11, cumulativeUsers: 4 },
    { date: "2026-08-29", termsCreated: 0, usersCreated: 1, revisions: 0, cumulativeTerms: 11, cumulativeUsers: 5 },
    { date: "2026-08-30", termsCreated: 1, usersCreated: 0, revisions: 4, cumulativeTerms: 12, cumulativeUsers: 5 },
  ]);
});

test("월 경계를 넘는 기간도 날짜 누락 없이 만든다", () => {
  const rows = buildDailyStatistics({
    today: "2026-03-01",
    days: 3,
    totalTerms: 0,
    totalUsers: 0,
    terms: [],
    users: [],
    revisions: [],
  });
  expect(rows.map((row) => row.date)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
});
