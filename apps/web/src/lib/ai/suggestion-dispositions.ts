import "server-only";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { aiSuggestionDecisions, terms } from "@glossary/db";
import { getDb } from "@/lib/db";

export const AI_SUGGESTION_FEATURES = ["agent", "identity", "definition", "classification", "duplicate"] as const;
export type AiSuggestionFeature = typeof AI_SUGGESTION_FEATURES[number];

export const AI_SUGGESTION_DISPOSITIONS = ["dismissed", "deferred", "saved"] as const;
export type AiSuggestionDisposition = typeof AI_SUGGESTION_DISPOSITIONS[number];

export type AiSuggestionDecision = typeof aiSuggestionDecisions.$inferSelect["disposition"];

export interface SuggestionSnapshot {
  title: string;
  field?: string;
  value?: unknown;
  reason?: string;
  href?: string;
}

export interface SuggestionDispositionInput {
  termId: string;
  revision: number;
  feature: AiSuggestionFeature;
  suggestionId: string;
  generatorVersion: number;
  disposition: AiSuggestionDisposition;
  reason?: string;
  payload?: SuggestionSnapshot;
  userId: string | null;
}

export interface SuggestionDecisionRecord {
  id: string;
  termId: string;
  revision: number;
  feature: AiSuggestionFeature;
  suggestionId: string;
  generatorVersion: number;
  scope: "shared" | "personal";
  disposition: AiSuggestionDisposition;
  reason: string;
  payload: SuggestionSnapshot;
  userId: string | null;
  remindAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalSuggestionTask extends SuggestionDecisionRecord {
  termSlug: string;
  termName: string;
}

export function suggestionDecisionKey(termId: string, revision: number, suggestionId: string): string {
  return `${termId}:${revision}:${suggestionId}`;
}

export function isHiddenSuggestionDisposition(disposition: AiSuggestionDisposition | undefined): boolean {
  return disposition === "dismissed" || disposition === "saved";
}

function rowToDecision(row: typeof aiSuggestionDecisions.$inferSelect): SuggestionDecisionRecord {
  return {
    id: row.id,
    termId: row.termId,
    revision: row.revision,
    feature: row.feature as AiSuggestionFeature,
    suggestionId: row.suggestionId,
    generatorVersion: row.generatorVersion,
    scope: row.scope,
    disposition: row.disposition,
    reason: row.reason,
    payload: (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : { title: "AI 제안" }) as SuggestionSnapshot,
    userId: row.userId,
    remindAt: row.remindAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 현재 리비전에서 공용 판단과 내 개인 판단을 함께 읽는다. 개인 판단이 우선한다. */
export async function listSuggestionDispositionMap(
  items: ReadonlyArray<{ termId: string; revision: number }>,
  feature: AiSuggestionFeature,
  userId: string | null,
  generatorVersion: number,
): Promise<Map<string, SuggestionDecisionRecord>> {
  if (items.length === 0) return new Map();
  const revisions = new Map(items.map((item) => [item.termId, item.revision]));
  const owner = userId ? or(isNull(aiSuggestionDecisions.userId), eq(aiSuggestionDecisions.userId, userId)) : isNull(aiSuggestionDecisions.userId);
  const rows = await getDb().select().from(aiSuggestionDecisions).where(and(
    inArray(aiSuggestionDecisions.termId, [...revisions.keys()]),
    eq(aiSuggestionDecisions.feature, feature),
    eq(aiSuggestionDecisions.generatorVersion, generatorVersion),
    owner,
  )).orderBy(desc(aiSuggestionDecisions.updatedAt));
  const result = new Map<string, SuggestionDecisionRecord>();
  const priority = (record: SuggestionDecisionRecord): number => record.scope === "personal" ? 2 : 1;
  for (const row of rows) {
    if (revisions.get(row.termId) !== row.revision) continue;
    const record = rowToDecision(row);
    const key = suggestionDecisionKey(record.termId, record.revision, record.suggestionId);
    const existing = result.get(key);
    if (!existing || priority(record) > priority(existing)) result.set(key, record);
  }
  return result;
}

export async function getSuggestionDisposition(
  termId: string,
  revision: number,
  feature: AiSuggestionFeature,
  suggestionId: string,
  userId: string | null,
  generatorVersion: number,
): Promise<SuggestionDecisionRecord | null> {
  const map = await listSuggestionDispositionMap([{ termId, revision }], feature, userId, generatorVersion);
  return map.get(suggestionDecisionKey(termId, revision, suggestionId)) ?? null;
}

export async function recordSuggestionDisposition(input: SuggestionDispositionInput): Promise<SuggestionDecisionRecord> {
  const scope = input.disposition === "saved" ? "personal" : "shared";
  if (scope === "personal" && !input.userId) throw new Error("PERSONAL_SUGGESTION_REQUIRES_USER");
  const db = getDb();
  const owner = scope === "personal" ? eq(aiSuggestionDecisions.userId, input.userId!) : isNull(aiSuggestionDecisions.userId);
  const where = and(
    eq(aiSuggestionDecisions.termId, input.termId),
    eq(aiSuggestionDecisions.revision, input.revision),
    eq(aiSuggestionDecisions.feature, input.feature),
    eq(aiSuggestionDecisions.suggestionId, input.suggestionId),
    eq(aiSuggestionDecisions.generatorVersion, input.generatorVersion),
    eq(aiSuggestionDecisions.scope, scope),
    owner,
  );
  const [record] = await db.transaction(async (tx) => {
    await tx.delete(aiSuggestionDecisions).where(where);
    return tx.insert(aiSuggestionDecisions).values({
      termId: input.termId,
      revision: input.revision,
      feature: input.feature,
      suggestionId: input.suggestionId,
      generatorVersion: input.generatorVersion,
      scope,
      disposition: input.disposition,
      reason: input.reason?.trim().slice(0, 500) ?? "",
      payload: input.payload ?? { title: "AI 제안" },
      userId: scope === "personal" ? input.userId : null,
      updatedAt: new Date(),
    }).returning();
  });
  if (!record) throw new Error("SUGGESTION_DISPOSITION_NOT_SAVED");
  return rowToDecision(record);
}

export async function removePersonalSuggestionDecision(decisionId: string, userId: string): Promise<boolean> {
  const removed = await getDb().delete(aiSuggestionDecisions).where(and(
    eq(aiSuggestionDecisions.id, decisionId),
    eq(aiSuggestionDecisions.scope, "personal"),
    eq(aiSuggestionDecisions.userId, userId),
  )).returning({ id: aiSuggestionDecisions.id });
  return removed.length > 0;
}

export async function listPersonalSuggestionTasks(userId: string, limit = 100): Promise<PersonalSuggestionTask[]> {
  const rows = await getDb().select({
    decision: aiSuggestionDecisions,
    termSlug: terms.slug,
    nameEn: terms.nameEn,
    nameKo: terms.nameKo,
  }).from(aiSuggestionDecisions)
    .innerJoin(terms, eq(terms.id, aiSuggestionDecisions.termId))
    .where(and(
      eq(aiSuggestionDecisions.scope, "personal"),
      eq(aiSuggestionDecisions.disposition, "saved"),
      eq(aiSuggestionDecisions.userId, userId),
    ))
    .orderBy(desc(aiSuggestionDecisions.updatedAt))
    .limit(Math.min(200, Math.max(1, limit)));
  return rows.map((row) => ({
    ...rowToDecision(row.decision),
    termSlug: row.termSlug,
    termName: row.nameKo ?? row.nameEn ?? row.termSlug,
  }));
}
