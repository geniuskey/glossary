import "server-only";

import { and, asc, count, desc, eq, ilike, ne, sql } from "drizzle-orm";
import { normalizeSurface } from "@glossary/engine";
import { unregisteredCandidates, type UnregisteredCandidateStatus } from "@glossary/db";
import { getDb } from "@/lib/db";
import { createTerm } from "@/lib/terms/create";
import type { TermInput } from "@/lib/terms/schema";
import type { ValidationFinding, ValidationHighlight } from "@glossary/engine";

export type CandidateStatus = UnregisteredCandidateStatus;

export interface CandidateListOptions {
  q?: string;
  status?: CandidateStatus;
  page?: number;
  pageSize?: number;
}

export interface CandidateListResult {
  items: Array<typeof unregisteredCandidates.$inferSelect>;
  total: number;
  page: number;
  pageSize: number;
}

export interface CandidateActor {
  userId?: string | null;
  keyId?: string | null;
}

export function toCandidateWire(candidate: typeof unregisteredCandidates.$inferSelect) {
  return {
    id: candidate.id,
    text: candidate.text,
    status: candidate.status,
    occurrenceCount: candidate.occurrenceCount,
    sampleContext: candidate.sampleContext,
    source: candidate.sourcePath,
    firstSeenAt: candidate.firstSeenAt.toISOString(),
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    lexiconVersion: candidate.lexiconVersion,
    promotedTermId: candidate.promotedTermId,
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
    decisionNote: candidate.decisionNote,
  };
}

function candidateContext(content: string, start: number, end: number): string {
  const left = content.slice(Math.max(0, start - 90), start).replace(/\s+/g, " ");
  const matched = content.slice(start, end).replace(/\s+/g, " ");
  const right = content.slice(end, Math.min(content.length, end + 90)).replace(/\s+/g, " ");
  return `${left}${matched}${right}`.trim();
}

export async function listCandidates(options: CandidateListOptions = {}): Promise<CandidateListResult> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 30)));
  const conditions = [];
  if (options.status) conditions.push(eq(unregisteredCandidates.status, options.status));
  if (options.q) conditions.push(ilike(unregisteredCandidates.text, `%${options.q}%`));

  const db = getDb();
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(unregisteredCandidates)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(unregisteredCandidates.occurrenceCount), desc(unregisteredCandidates.lastSeenAt), asc(unregisteredCandidates.text))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: count() })
      .from(unregisteredCandidates)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  return { items: rows, total: Number(totalRows[0]?.count ?? 0), page, pageSize };
}

/** 검증 결과에서 후보만 추려 한 문서의 반복 표기를 한 번에 합산한다. */
export async function recordUnregisteredCandidates(input: {
  content: string;
  findings: readonly ValidationFinding[];
  highlights?: readonly ValidationHighlight[];
  path?: string | null;
  lexiconVersion?: string;
}): Promise<void> {
  const grouped = new Map<string, {
    text: string;
    count: number;
    context: string;
  }>();

  for (const finding of input.findings) {
    if (finding.rule !== "unregistered") continue;
    const normLoose = normalizeSurface(finding.text).loose;
    if (!normLoose) continue;
    const existing = grouped.get(normLoose);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(normLoose, {
      text: finding.text,
      count: 1,
      context: candidateContext(input.content, finding.start, finding.end),
    });
  }

  if (input.highlights) {
    for (const item of grouped.values()) item.count = 0;
    for (const highlight of input.highlights) {
      if (highlight.kind !== "unregistered") continue;
      const normLoose = normalizeSurface(highlight.text).loose;
      if (!normLoose) continue;
      const existing = grouped.get(normLoose);
      if (existing) existing.count += 1;
      else grouped.set(normLoose, {
        text: highlight.text,
        count: 1,
        context: candidateContext(input.content, highlight.start, highlight.end),
      });
    }
    // Findings may extend beyond the response's capped highlight list.
    for (const item of grouped.values()) item.count = Math.max(1, item.count);
  }

  if (grouped.size === 0) return;
  const db = getDb();
  const now = new Date();
  for (const [normLoose, item] of grouped) {
    await db
      .insert(unregisteredCandidates)
      .values({
        normLoose,
        text: item.text,
        occurrenceCount: item.count,
        sampleContext: item.context,
        sourcePath: input.path ?? null,
        lexiconVersion: input.lexiconVersion ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: unregisteredCandidates.normLoose,
        set: {
          occurrenceCount: sql`${unregisteredCandidates.occurrenceCount} + ${item.count}`,
          lastSeenAt: now,
          sampleContext: item.context,
          sourcePath: input.path ?? null,
          lexiconVersion: input.lexiconVersion ?? null,
          updatedAt: now,
        },
      });
  }
}

export async function getCandidate(id: string) {
  const [candidate] = await getDb()
    .select()
    .from(unregisteredCandidates)
    .where(eq(unregisteredCandidates.id, id))
    .limit(1);
  return candidate ?? null;
}

export async function dismissCandidate(id: string, actor: CandidateActor, note?: string | null) {
  const existing = await getCandidate(id);
  if (!existing) return null;
  if (existing.status === "promoted") return existing;
  const [updated] = await getDb()
    .update(unregisteredCandidates)
    .set({
      status: "dismissed",
      reviewedBy: actor.userId ?? null,
      reviewedAt: new Date(),
      decisionNote: note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(unregisteredCandidates.id, id), ne(unregisteredCandidates.status, "promoted")))
    .returning();
  return updated ?? existing;
}

export async function promoteCandidate(id: string, input: TermInput, actor: CandidateActor) {
  const candidate = await getCandidate(id);
  if (!candidate) return { kind: "not_found" as const };
  if (candidate.status === "promoted") return { kind: "already_promoted" as const, candidate };
  if (candidate.status === "dismissed") return { kind: "dismissed" as const, candidate };

  const created = await createTerm(input, actor.userId ?? null, actor.keyId ?? null);
  const [updated] = await getDb()
    .update(unregisteredCandidates)
    .set({
      status: "promoted",
      promotedTermId: created.term.id,
      reviewedBy: actor.userId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(unregisteredCandidates.id, id), eq(unregisteredCandidates.status, "open")))
    .returning();

  return { kind: "promoted" as const, candidate: updated ?? candidate, created };
}
