import "server-only";
import { and, arrayContains, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { aiReviewSuggestions, termRelations, termRevisions, terms, users } from "@glossary/db";
import { getDb } from "@/lib/db";
import type { ManagedRelation, RelationPage, RelationStatus, RelationType } from "./relation-values";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const source = alias(terms, "relation_source");
const target = alias(terms, "relation_target");
const revisionFor = (id: SQL) => sql<number>`(select coalesce(max(${termRevisions.revisionNumber}), 0)::int from ${termRevisions} where ${termRevisions.termId} = ${id})`;
const sourceRevision = revisionFor(sql`${termRelations.sourceTermId}`);
const targetRevision = revisionFor(sql`${termRelations.targetTermId}`);
const relationVersion = sql<string>`${termRelations}.xmin::text`;

export async function relationForDecision(id: string) {
  const [row] = await getDb().select({ relation: termRelations, version: relationVersion }).from(termRelations).where(eq(termRelations.id, id));
  return row;
}

// Both the graph and retrieval apply this predicate before expanding neighbors.
// Legacy rows with no recorded revisions retain their existing eligibility.
export function usableRelationWhere() {
  return and(
    eq(termRelations.status, "approved"),
    sql`(${termRelations.sourceRevision} is null or ${termRelations.sourceRevision} = ${sourceRevision})`,
    sql`(${termRelations.targetRevision} is null or ${termRelations.targetRevision} = ${targetRevision})`,
  );
}

export async function approvedRelations(db: Db | Tx, termIds: string[], limit = 40, domain?: string) {
  if (!termIds.length) return [];
  const where = and(
    usableRelationWhere(),
    or(inArray(termRelations.sourceTermId, termIds), inArray(termRelations.targetTermId, termIds)),
  );
  if (!domain) return db.select().from(termRelations).where(where).orderBy(desc(termRelations.confidence), termRelations.id).limit(limit);
  const scopedSource = alias(terms, "approved_relation_source");
  const scopedTarget = alias(terms, "approved_relation_target");
  const rows = await db.select({ relation: termRelations }).from(termRelations)
    .innerJoin(scopedSource, eq(scopedSource.id, termRelations.sourceTermId))
    .innerJoin(scopedTarget, eq(scopedTarget.id, termRelations.targetTermId))
    .where(and(where, arrayContains(scopedSource.domain, [domain]), arrayContains(scopedTarget.domain, [domain])))
    .orderBy(desc(termRelations.confidence), termRelations.id)
    .limit(limit);
  return rows.map((row) => row.relation);
}

export async function semanticGraphRelations(termIds: string[]) {
  if (!termIds.length) return { items: [], omitted: 0 };
  const db = getDb();
  const touching = or(inArray(termRelations.sourceTermId, termIds), inArray(termRelations.targetTermId, termIds));
  const [items, [counted]] = await Promise.all([
    db.select().from(termRelations).where(and(usableRelationWhere(), inArray(termRelations.sourceTermId, termIds), inArray(termRelations.targetTermId, termIds)))
      .orderBy(desc(termRelations.confidence), termRelations.id).limit(500),
    db.select({ total: sql<number>`count(*)::int` }).from(termRelations).where(and(usableRelationWhere(), touching)),
  ]);
  return { items: items.map(({ id, sourceTermId, targetTermId, relationType, evidenceMd }) => ({ id, sourceTermId, targetTermId, relationType, evidenceMd })), omitted: Math.max(0, (counted?.total ?? 0) - items.length) };
}

export async function listRelations(filters: { termId?: string; status?: RelationStatus; type?: RelationType; page?: number } = {}): Promise<RelationPage> {
  const page = filters.page ?? 1;
  const where = and(
    filters.termId ? or(eq(termRelations.sourceTermId, filters.termId), eq(termRelations.targetTermId, filters.termId)) : undefined,
    filters.status ? eq(termRelations.status, filters.status) : undefined,
    filters.type ? eq(termRelations.relationType, filters.type) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    getDb().select({
      relation: termRelations,
      version: relationVersion,
      reviewerName: users.name,
      source: { id: source.id, slug: source.slug, name: sql<string>`coalesce(${source.nameKo}, ${source.nameEn}, ${source.slug})`, definition: source.definitionMd, domain: source.domain, revision: sourceRevision },
      target: { id: target.id, slug: target.slug, name: sql<string>`coalesce(${target.nameKo}, ${target.nameEn}, ${target.slug})`, definition: target.definitionMd, domain: target.domain, revision: targetRevision },
    }).from(termRelations).innerJoin(source, eq(source.id, termRelations.sourceTermId)).innerJoin(target, eq(target.id, termRelations.targetTermId))
      .leftJoin(users, eq(users.id, termRelations.reviewedBy)).where(where).orderBy(desc(termRelations.createdAt), termRelations.id).limit(20).offset((page - 1) * 20),
    getDb().select({ total: sql<number>`count(*)::int` }).from(termRelations).where(where),
  ]);
  const items: ManagedRelation[] = rows.map((row) => ({
    ...row.relation, source: row.source, target: row.target, version: row.version, reviewerName: row.reviewerName,
    reviewedAt: row.relation.reviewedAt?.toISOString() ?? null,
    stale: (row.relation.sourceRevision !== null && row.relation.sourceRevision !== row.source.revision)
      || (row.relation.targetRevision !== null && row.relation.targetRevision !== row.target.revision),
  }));
  return { items, total: counted?.total ?? 0, page };
}

type CreateRelation = { sourceTermId: string; targetTermId: string; relationType: RelationType; evidenceMd: string; sourceRevision: number; targetRevision: number };
type EditRelation = { action: "edit"; relationType: RelationType; evidenceMd: string; sourceRevision: number; targetRevision: number };
export type ChangeRelation = (EditRelation | { action: "approved" | "rejected" }) & { version: string };
type Result = { ok: true; id: string } | { error: "not_found" | "conflict" | "stale" | "duplicate" | "invalid" };

async function lockTerms(tx: Tx, ids: string[]) {
  // Lock in a stable order and then read revisions in a fresh READ COMMITTED statement.
  const locked = await tx.select({ id: terms.id }).from(terms).where(inArray(terms.id, ids)).orderBy(terms.id).for("update");
  if (locked.length !== 2) return null;
  const revisions = await tx.select({ id: terms.id, revision: revisionFor(sql`${terms.id}`) }).from(terms).where(inArray(terms.id, ids));
  return new Map(revisions.map((row) => [row.id, row.revision]));
}

function isDuplicate(error: unknown): boolean {
  const candidate = error as { code?: string; constraint_name?: string; cause?: unknown };
  return (candidate?.code === "23505" && candidate.constraint_name === "term_relations_unique") || !!(candidate?.cause && isDuplicate(candidate.cause));
}

export async function createRelation(input: CreateRelation, userId: string): Promise<Result> {
  if (input.sourceTermId === input.targetTermId) return { error: "invalid" };
  try {
    return await getDb().transaction(async (tx): Promise<Result> => {
      const revisions = await lockTerms(tx, [input.sourceTermId, input.targetTermId]);
      if (!revisions) return { error: "not_found" };
      if (revisions.get(input.sourceTermId) !== input.sourceRevision || revisions.get(input.targetTermId) !== input.targetRevision) return { error: "stale" };
      const [row] = await tx.insert(termRelations).values({ ...input, status: "proposed", createdBy: userId }).returning({ id: termRelations.id });
      return { ok: true, id: row!.id };
    });
  } catch (error) { if (isDuplicate(error)) return { error: "duplicate" }; throw error; }
}

export async function changeRelation(id: string, input: ChangeRelation, userId: string | null): Promise<Result> {
  try {
    return await getDb().transaction(async (tx): Promise<Result> => {
      const [initial] = await tx.select().from(termRelations).where(eq(termRelations.id, id));
      if (!initial) return { error: "not_found" };
      const revisions = await lockTerms(tx, [initial.sourceTermId, initial.targetTermId]);
      if (!revisions) return { error: "not_found" };
      const [row] = await tx.select({ relation: termRelations, version: relationVersion }).from(termRelations).where(eq(termRelations.id, id)).for("update");
      if (!row) return { error: "not_found" };
      if (row.version !== input.version) return { error: "conflict" };
      const relation = row.relation;
      const source = revisions.get(relation.sourceTermId)!;
      const target = revisions.get(relation.targetTermId)!;
      if (input.action === "edit") {
        if (input.sourceRevision !== source || input.targetRevision !== target) return { error: "stale" };
        await tx.update(termRelations).set({ relationType: input.relationType, evidenceMd: input.evidenceMd, sourceRevision: source, targetRevision: target,
          status: "proposed", reviewedBy: userId, reviewedAt: new Date() }).where(eq(termRelations.id, id));
      } else {
        if (input.action === "approved") {
          if (relation.status !== "proposed") return { error: "conflict" };
          if ((relation.sourceRevision !== null && relation.sourceRevision !== source) || (relation.targetRevision !== null && relation.targetRevision !== target)) return { error: "stale" };
          if (!relation.evidenceMd?.trim()) return { error: "invalid" };
        }
        await tx.update(termRelations).set({ status: input.action, reviewedBy: userId, reviewedAt: new Date(),
          ...(input.action === "approved" ? { sourceRevision: source || null, targetRevision: target || null } : {}),
        }).where(eq(termRelations.id, id));
      }
      // Remove just this cached AI proposal atomically; preserve unrelated suggestions.
      await tx.update(aiReviewSuggestions).set({ suggestions: sql`(
        select coalesce(jsonb_agg(item), '[]'::jsonb)
        from jsonb_array_elements(${aiReviewSuggestions.suggestions}) as item
        where (item->'value'->>'relationId') is distinct from ${id}
      )` }).where(eq(aiReviewSuggestions.termId, relation.sourceTermId));
      return { ok: true, id };
    });
  } catch (error) { if (isDuplicate(error)) return { error: "duplicate" }; throw error; }
}
