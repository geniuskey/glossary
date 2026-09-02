import "server-only";

import { sql } from "drizzle-orm";
import { termRevisions, terms, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { buildDailyStatistics, type DailyCount, type DailyStatisticsPoint } from "./statistics-series";

const REPORT_TIME_ZONE = "Asia/Seoul";

export interface GroupStatistics {
  name: string;
  total: number;
  active: number;
  draft: number;
  withOwner: number;
  updated30d: number;
  stale90d: number;
  lastUpdatedAt: string | null;
}

export interface PlatformStatistics {
  generatedAt: string;
  timeZone: string;
  days: number;
  totals: {
    terms: number;
    users: number;
    activeTerms: number;
    revisions30d: number;
    terms30d: number;
    users30d: number;
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

function normalizeGroups(rows: Array<{
  name: string;
  total: number;
  active: number;
  draft: number;
  withOwner: number;
  updated30d: number;
  stale90d: number;
  lastUpdatedAt: Date | string | null;
}>): GroupStatistics[] {
  return rows.map((row) => ({
    name: row.name,
    total: numberOf(row.total),
    active: numberOf(row.active),
    draft: numberOf(row.draft),
    withOwner: numberOf(row.withOwner),
    updated30d: numberOf(row.updated30d),
    stale90d: numberOf(row.stale90d),
    lastUpdatedAt: row.lastUpdatedAt == null
      ? null
      : new Date(row.lastUpdatedAt).toISOString(),
  }));
}

export async function getPlatformStatistics(days: 30 | 90 | 180 = 30): Promise<PlatformStatistics> {
  const db = getDb();
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
    }).from(terms),
    db.select({
      total: sql<number>`count(*)::int`,
      recent: sql<number>`count(*) filter (where ${users.createdAt} >= current_timestamp - interval '30 days')::int`,
    }).from(users),
    db.select({ recent: sql<number>`count(*)::int` })
      .from(termRevisions)
      .where(sql`${termRevisions.createdAt} >= current_timestamp - interval '30 days'`),
    db.select({ day: termDay, count: sql<number>`count(*)::int` })
      .from(terms).where(inWindow(terms.createdAt)).groupBy(termDay).orderBy(termDay),
    db.select({ day: userDay, count: sql<number>`count(*)::int` })
      .from(users).where(inWindow(users.createdAt)).groupBy(userDay).orderBy(userDay),
    db.select({ day: revisionDay, count: sql<number>`count(*)::int` })
      .from(termRevisions).where(inWindow(termRevisions.createdAt)).groupBy(revisionDay).orderBy(revisionDay),
    db.select({ name: categoryTerms.name, ...groupFields(categoryTerms) })
      .from(categoryTerms).groupBy(categoryTerms.name).orderBy(sql`count(*) desc`, categoryTerms.name),
    db.select({ name: domainTerms.name, ...groupFields(domainTerms) })
      .from(domainTerms).groupBy(domainTerms.name).orderBy(sql`count(*) desc`, domainTerms.name),
  ]);

  const totalTerms = numberOf(termTotals?.total);
  const totalUsers = numberOf(userTotals?.total);
  const daily = buildDailyStatistics({
    today: reportDay(),
    days,
    totalTerms,
    totalUsers,
    terms: termDays as DailyCount[],
    users: userDays as DailyCount[],
    revisions: revisionDays as DailyCount[],
  });

  return {
    generatedAt: new Date().toISOString(),
    timeZone: REPORT_TIME_ZONE,
    days,
    totals: {
      terms: totalTerms,
      users: totalUsers,
      activeTerms: numberOf(termTotals?.active),
      revisions30d: numberOf(revisionTotals?.recent),
      terms30d: numberOf(termTotals?.recent),
      users30d: numberOf(userTotals?.recent),
    },
    daily,
    categories: normalizeGroups(categoryRows),
    domains: normalizeGroups(domainRows),
  };
}
