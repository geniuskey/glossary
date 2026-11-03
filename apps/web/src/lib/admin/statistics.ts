import "server-only";

import { and, sql } from "drizzle-orm";
import { termRevisions, terms, users } from "@glossary/db";
import { getDb } from "@/lib/db";
import {
  buildDailyStatistics,
  normalizeGroups,
  type DailyCount,
  type DailyStatisticsPoint,
  type GroupStatistics,
  type StatisticsAudience,
} from "./statistics-series";

const REPORT_TIME_ZONE = "Asia/Seoul";

export type { GroupStatistics, StatisticsAudience };

export interface PlatformStatistics {
  audience: StatisticsAudience;
  generatedAt: string;
  timeZone: string;
  days: number;
  totals: {
    terms: number;
    activeTerms: number;
    revisions30d: number;
    terms30d: number;
    users?: number;
    users30d?: number;
  };
  daily: DailyStatisticsPoint[];
  categories: GroupStatistics[];
  domains: GroupStatistics[];
}

function reportDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function numberOf(value: unknown): number {
  return Number(value ?? 0);
}

export async function getPlatformStatistics({
  days = 30,
  audience,
}: {
  days?: 30 | 90 | 180;
  audience: StatisticsAudience;
}): Promise<PlatformStatistics> {
  const db = getDb();
  const isPublic = audience === "public";
  // 공개 집계는 용어 쪽 전부를 공개(active) 용어로만 센다. 그룹 표만 거르면 전체 용어 수와
  // 공개 수의 차이, 일별 신규 막대로 초안 규모가 그대로 역산된다.
  const visibleTerms = isPublic ? sql`${terms.status} <> 'draft'` : sql`true`;
  const dayOf = (column: unknown) => sql<string>`to_char(${column} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
  // 양쪽을 서울 기준 date로 만든 뒤 비교한다. `date - integer at time zone ...`처럼
  // 해석될 여지를 남기면 Postgres가 timezone(unknown, integer)를 찾다가 실패한다.
  const inWindow = (column: unknown) => sql`(${column} at time zone 'Asia/Seoul')::date >= ((current_timestamp at time zone 'Asia/Seoul')::date - ${days - 1}::int)`;
  const termDay = dayOf(terms.createdAt);
  const userDay = dayOf(users.createdAt);
  const revisionDay = dayOf(termRevisions.createdAt);

  const domainTerms = db
    .select({
      name: sql<string>`unnest(${terms.domain})`.as("name"),
      status: terms.status,
      ownerId: terms.ownerId,
      createdAt: terms.createdAt,
      updatedAt: terms.updatedAt,
    })
    .from(terms)
    .where(visibleTerms)
    .as("domain_terms");

  const categoryTerms = db
    .select({
      name: sql<string>`unnest(case when cardinality(${terms.category}) = 0 then array['미분류']::text[] else ${terms.category} end)`.as("name"),
      status: terms.status,
      ownerId: terms.ownerId,
      createdAt: terms.createdAt,
      updatedAt: terms.updatedAt,
    })
    .from(terms)
    .where(visibleTerms)
    .as("category_terms");

  const groupFields = (source: typeof terms | typeof domainTerms | typeof categoryTerms) => ({
    total: sql<number>`count(*)::int`,
    active: sql<number>`count(*) filter (where ${source.status} = 'active')::int`,
    draft: sql<number>`count(*) filter (where ${source.status} = 'draft')::int`,
    withOwner: sql<number>`count(*) filter (where ${source.ownerId} is not null)::int`,
    updated30d: sql<number>`count(*) filter (where ${source.updatedAt} >= current_timestamp - interval '30 days')::int`,
    stale90d: sql<number>`count(*) filter (where ${source.updatedAt} < current_timestamp - interval '90 days')::int`,
    lastUpdatedAt: sql<Date | null>`max(${source.updatedAt})`,
  });

  const [
    [termTotals],
    [userTotals],
    [revisionTotals],
    termDays,
    userDays,
    revisionDays,
    categoryRows,
    domainRows,
  ] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${terms.status} = 'active')::int`,
      recent: sql<number>`count(*) filter (where ${terms.createdAt} >= current_timestamp - interval '30 days')::int`,
    }).from(terms).where(visibleTerms),
    isPublic
      ? Promise.resolve([undefined])
      : db.select({
        total: sql<number>`count(*)::int`,
        recent: sql<number>`count(*) filter (where ${users.createdAt} >= current_timestamp - interval '30 days')::int`,
      }).from(users),
    db.select({ recent: sql<number>`count(*)::int` })
      .from(termRevisions)
      .where(sql`${termRevisions.createdAt} >= current_timestamp - interval '30 days'`),
    db.select({ day: termDay, count: sql<number>`count(*)::int` })
      .from(terms).where(and(inWindow(terms.createdAt), visibleTerms)).groupBy(termDay).orderBy(termDay),
    isPublic
      ? Promise.resolve(null)
      : db.select({ day: userDay, count: sql<number>`count(*)::int` })
        .from(users).where(inWindow(users.createdAt)).groupBy(userDay).orderBy(userDay),
    db.select({ day: revisionDay, count: sql<number>`count(*)::int` })
      .from(termRevisions).where(inWindow(termRevisions.createdAt)).groupBy(revisionDay).orderBy(revisionDay),
    db.select({ name: categoryTerms.name, ...groupFields(categoryTerms) })
      .from(categoryTerms).groupBy(categoryTerms.name).orderBy(sql`count(*) desc`, categoryTerms.name),
    db.select({ name: domainTerms.name, ...groupFields(domainTerms) })
      .from(domainTerms).groupBy(domainTerms.name).orderBy(sql`count(*) desc`, domainTerms.name),
  ]);

  const totalTerms = numberOf(termTotals?.total);
  const daily = buildDailyStatistics({
    today: reportDay(),
    days,
    totalTerms,
    terms: termDays as DailyCount[],
    revisions: revisionDays as DailyCount[],
    ...(userTotals && userDays ? { totalUsers: numberOf(userTotals.total), users: userDays as DailyCount[] } : {}),
  });

  return {
    audience,
    generatedAt: new Date().toISOString(),
    timeZone: REPORT_TIME_ZONE,
    days,
    totals: {
      terms: totalTerms,
      activeTerms: numberOf(termTotals?.active),
      revisions30d: numberOf(revisionTotals?.recent),
      terms30d: numberOf(termTotals?.recent),
      ...(userTotals ? { users: numberOf(userTotals.total), users30d: numberOf(userTotals.recent) } : {}),
    },
    daily,
    categories: normalizeGroups(categoryRows, audience),
    domains: normalizeGroups(domainRows, audience),
  };
}
