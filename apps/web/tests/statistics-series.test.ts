import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { buildDailyStatistics, normalizeGroups } from "../src/lib/admin/statistics-series.js";

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

test("사용자 집계를 넘기지 않으면 일별 포인트에 사용자 키 자체가 없다", () => {
  const rows = buildDailyStatistics({
    today: "2026-08-30",
    days: 2,
    totalTerms: 3,
    terms: [{ day: "2026-08-30", count: 1 }],
    revisions: [],
  });
  expect(rows).toEqual([
    { date: "2026-08-29", termsCreated: 0, revisions: 0, cumulativeTerms: 2 },
    { date: "2026-08-30", termsCreated: 1, revisions: 0, cumulativeTerms: 3 },
  ]);
  for (const row of rows) {
    expect(row).not.toHaveProperty("usersCreated");
    expect(row).not.toHaveProperty("cumulativeUsers");
  }
});

const groupRows = [
  { name: "반도체", total: 5, active: 3, draft: 2, withOwner: 4, updated30d: 1, stale90d: 0, lastUpdatedAt: "2026-08-01T00:00:00.000Z" },
  { name: "비공개 프로젝트", total: 2, active: 0, draft: 2, withOwner: 2, updated30d: 2, stale90d: 0, lastUpdatedAt: null },
];

test("공개 집계는 공개 용어가 없는 그룹을 빼고 draft 키를 내보내지 않는다", () => {
  const rows = normalizeGroups(groupRows, "public");
  expect(rows.map((row) => row.name)).toEqual(["반도체"]);
  expect(rows[0]).not.toHaveProperty("draft");
  expect(rows[0]!.total).toBe(3);
});

test("회원 집계는 초안만 있는 그룹과 draft 수를 그대로 둔다", () => {
  const rows = normalizeGroups(groupRows, "member");
  expect(rows.map((row) => [row.name, row.total, row.draft])).toEqual([["반도체", 5, 2], ["비공개 프로젝트", 2, 2]]);
});

test("통계 페이지는 로그인 여부로 집계 범위를 정한다", () => {
  const page = readFileSync(path.resolve(import.meta.dirname, "../src/app/statistics/page.tsx"), "utf8");
  expect(page).toContain('audience: user ? "member" : "public"');
});
