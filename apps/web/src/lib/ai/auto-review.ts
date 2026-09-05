import "server-only";

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { aiReviewQueue, aiReviewSuggestions, termRelations, terms, users } from "@glossary/db";
import { getDb } from "@/lib/db";
import { currentRevisionNumber } from "@/lib/terms/update";
import { getTermByIdOrSlug, termNeedsContribution } from "@/lib/terms/query";
import { loadAiConfig, publicAiConfig } from "./config";
import { generateContributionSuggestions } from "./contribution-agent";
import {
  CONTRIBUTION_RELATION_TYPES,
  type ContributionSuggestion,
  type RelationContributionSuggestion,
} from "./contribution-suggestions";

export interface PreparedReview {
  termId: string;
  revision: number;
  suggestions: ContributionSuggestion[];
}

export type ReviewQueueStatus = "queued" | "processing" | "ready" | "failed";
export type ReviewRequestMode = "automatic" | "manual";

export interface ReviewQueueItem {
  termId: string;
  revision: number;
  status: ReviewQueueStatus;
  requestMode: ReviewRequestMode;
  termSlug: string;
  termName: string;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface ReviewQueueSnapshot {
  counts: { total: number; active: number; queued: number; processing: number; ready: number; failed: number };
  items: ReviewQueueItem[];
}

const inFlight = new Map<string, Promise<PreparedReview | null>>();
const retryAfter = new Map<string, number>();
const FAILURE_COOLDOWN_MS = 5 * 60 * 1_000;
const AUTO_REVIEW_GENERATOR_VERSION = 2;

function validSuggestions(value: unknown): ContributionSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ContributionSuggestion => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.reason !== "string") return false;
    if (item.field === "relation") {
      const relation = item.value;
      return item.source === "agent" && relation && typeof relation === "object"
        && typeof relation.relationId === "string"
        && typeof relation.targetTermId === "string"
        && typeof relation.targetSlug === "string"
        && typeof relation.targetName === "string"
        && typeof relation.relationType === "string"
        && CONTRIBUTION_RELATION_TYPES.includes(relation.relationType as typeof CONTRIBUTION_RELATION_TYPES[number])
        && typeof relation.confidence === "number";
    }
    return (item.field === "definitionMd" || item.field === "domain" || item.field === "category")
      && (typeof item.value === "string" || Array.isArray(item.value))
      && (item.source === "rule" || item.source === "agent");
  });
}

async function materializeRelationSuggestions(
  termId: string,
  revision: number,
  suggestions: ContributionSuggestion[],
): Promise<ContributionSuggestion[]> {
  const relationSuggestions = suggestions.filter((item): item is RelationContributionSuggestion => item.field === "relation");
  if (relationSuggestions.length === 0) return suggestions;
  const existing = await getDb().select().from(termRelations).where(eq(termRelations.sourceTermId, termId));
  const byKey = new Map(existing.map((row) => [`${row.targetTermId}:${row.relationType}`, row]));
  const accepted: ContributionSuggestion[] = suggestions.filter((item) => item.field !== "relation");

  for (const suggestion of relationSuggestions) {
    const key = `${suggestion.value.targetTermId}:${suggestion.value.relationType}`;
    const found = byKey.get(key);
    if (found?.status === "approved" || found?.status === "rejected") continue;
    const targetRevision = await currentRevisionNumber(suggestion.value.targetTermId);
    if (targetRevision < 1) continue;
    let relationId: string | undefined;
    if (found?.status === "proposed") {
      relationId = found.id;
      await getDb().update(termRelations).set({
        confidence: suggestion.value.confidence,
        evidenceMd: suggestion.reason,
        sourceRevision: revision,
        targetRevision,
      }).where(and(eq(termRelations.id, found.id), eq(termRelations.status, "proposed")));
    } else {
      const [created] = await getDb().insert(termRelations).values({
        sourceTermId: termId,
        targetTermId: suggestion.value.targetTermId,
        relationType: suggestion.value.relationType,
        status: "proposed",
        confidence: suggestion.value.confidence,
        evidenceMd: suggestion.reason,
        sourceRevision: revision,
        targetRevision,
      }).onConflictDoNothing().returning({ id: termRelations.id });
      relationId = created?.id;
      if (!relationId) {
        const [raced] = await getDb().select({ id: termRelations.id, status: termRelations.status }).from(termRelations).where(and(
          eq(termRelations.sourceTermId, termId),
          eq(termRelations.targetTermId, suggestion.value.targetTermId),
          eq(termRelations.relationType, suggestion.value.relationType),
        )).limit(1);
        if (raced?.status === "proposed") {
          relationId = raced.id;
          await getDb().update(termRelations).set({
            confidence: suggestion.value.confidence,
            evidenceMd: suggestion.reason,
            sourceRevision: revision,
            targetRevision,
          }).where(and(eq(termRelations.id, raced.id), eq(termRelations.status, "proposed")));
        }
      }
    }
    if (relationId) accepted.push({ ...suggestion, value: { ...suggestion.value, relationId } });
  }
  return accepted.slice(0, 3);
}

export async function getPreparedReview(termId: string, revision: number): Promise<PreparedReview | null> {
  const [row] = await getDb().select().from(aiReviewSuggestions).where(and(
    eq(aiReviewSuggestions.termId, termId),
    eq(aiReviewSuggestions.revision, revision),
  )).limit(1);
  return row?.generatorVersion === AUTO_REVIEW_GENERATOR_VERSION
    ? { termId, revision, suggestions: validSuggestions(row.suggestions) }
    : null;
}

export async function listPreparedReviews(terms: ReadonlyArray<{ id: string; revision: number }>): Promise<Record<string, PreparedReview>> {
  if (terms.length === 0) return {};
  const revisions = new Map(terms.map((term) => [term.id, term.revision]));
  const rows = await getDb().select().from(aiReviewSuggestions).where(inArray(aiReviewSuggestions.termId, [...revisions.keys()]));
  return Object.fromEntries(rows
    .filter((row) => revisions.get(row.termId) === row.revision && row.generatorVersion === AUTO_REVIEW_GENERATOR_VERSION)
    .map((row) => [row.termId, { termId: row.termId, revision: row.revision, suggestions: validSuggestions(row.suggestions) }]));
}

async function generateAndStore(termId: string, expectedRevision: number, force = false, requireAutomatic = true): Promise<PreparedReview | null> {
  const config = await loadAiConfig();
  if (!config.enabled || (requireAutomatic && !config.autoReviewEnabled) || !(await termNeedsContribution(termId))) return null;
  const term = await getTermByIdOrSlug(termId);
  if (!term) return null;
  const revision = await currentRevisionNumber(termId);
  if (revision !== expectedRevision) return null;
  const cached = force ? null : await getPreparedReview(termId, revision);
  if (cached) return cached;
  const generated = await generateContributionSuggestions(term);
  if (await currentRevisionNumber(termId) !== revision) return null;
  const suggestions = await materializeRelationSuggestions(termId, revision, generated);
  await getDb().insert(aiReviewSuggestions).values({ termId, revision, generatorVersion: AUTO_REVIEW_GENERATOR_VERSION, suggestions }).onConflictDoUpdate({
    target: aiReviewSuggestions.termId,
    set: { revision, generatorVersion: AUTO_REVIEW_GENERATOR_VERSION, suggestions, generatedAt: new Date() },
  });
  return { termId, revision, suggestions };
}

async function enqueueReview(termId: string, revision: number, requestMode: ReviewRequestMode, requestedBy: string | null): Promise<void> {
  await getDb().insert(aiReviewQueue).values({ termId, revision, requestMode, requestedBy }).onConflictDoUpdate({
    target: aiReviewQueue.termId,
    set: {
      revision,
      status: "queued",
      requestMode,
      requestedBy,
      requestedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
}

async function processQueuedReview(termId: string, requestMode: ReviewRequestMode): Promise<PreparedReview | null> {
  const running = inFlight.get(termId);
  if (running) {
    await running;
    const [next] = await getDb().select({ status: aiReviewQueue.status, requestMode: aiReviewQueue.requestMode })
      .from(aiReviewQueue).where(eq(aiReviewQueue.termId, termId)).limit(1);
    return next?.status === "queued" ? processQueuedReview(termId, next.requestMode) : null;
  }
  if (requestMode === "automatic" && (retryAfter.get(termId) ?? 0) > Date.now()) return null;
  const task = (async () => {
    const [job] = await getDb().select({ revision: aiReviewQueue.revision }).from(aiReviewQueue)
      .where(eq(aiReviewQueue.termId, termId)).limit(1);
    if (!job) return null;
    const [claimed] = await getDb().update(aiReviewQueue)
      .set({ status: "processing", startedAt: new Date(), finishedAt: null, errorMessage: null })
      .where(and(eq(aiReviewQueue.termId, termId), eq(aiReviewQueue.revision, job.revision), eq(aiReviewQueue.status, "queued")))
      .returning({ termId: aiReviewQueue.termId });
    if (!claimed) return null;
    try {
      const review = await generateAndStore(termId, job.revision, requestMode === "manual", requestMode === "automatic");
      if (!review) throw new Error("REVIEW_NOT_AVAILABLE");
      await getDb().update(aiReviewQueue).set({ status: "ready", finishedAt: new Date(), errorMessage: null })
        .where(and(eq(aiReviewQueue.termId, termId), eq(aiReviewQueue.revision, job.revision), eq(aiReviewQueue.status, "processing")));
      retryAfter.delete(termId);
      return review;
    } catch (error) {
      if (requestMode === "automatic") retryAfter.set(termId, Date.now() + FAILURE_COOLDOWN_MS);
      await getDb().update(aiReviewQueue).set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "AI 검토를 완료하지 못했습니다.",
      }).where(and(eq(aiReviewQueue.termId, termId), eq(aiReviewQueue.revision, job.revision), eq(aiReviewQueue.status, "processing")));
      console.error(`${requestMode === "manual" ? "수동" : "자동"} AI 검토 준비 실패`, error);
      return null;
    }
  })().finally(() => inFlight.delete(termId));
  inFlight.set(termId, task);
  return task;
}

export async function prepareAutoReview(termId: string): Promise<PreparedReview | null> {
  const config = await loadAiConfig();
  if (!config.enabled || !config.autoReviewEnabled || !(await termNeedsContribution(termId))) return null;
  const revision = await currentRevisionNumber(termId);
  if (revision < 1) return null;
  await enqueueReview(termId, revision, "automatic", null);
  return processQueuedReview(termId, "automatic");
}

export async function requestManualReview(termId: string, revision: number, requestedBy: string | null): Promise<"queued" | "ai_disabled" | "not_eligible" | "revision_conflict"> {
  const config = await loadAiConfig();
  if (!config.enabled || !publicAiConfig(config).secretsReadable) return "ai_disabled";
  if (!(await termNeedsContribution(termId))) return "not_eligible";
  if (await currentRevisionNumber(termId) !== revision) return "revision_conflict";
  await enqueueReview(termId, revision, "manual", requestedBy);
  return "queued";
}

export function prepareManualReview(termId: string): Promise<PreparedReview | null> {
  return processQueuedReview(termId, "manual");
}

/** 기존 대기열을 한꺼번에 켤 때 외부 AI 서버를 과도하게 병렬 호출하지 않도록 제한한다. */
export async function prepareAutoReviews(termIds: readonly string[], concurrency = 2): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < termIds.length) {
      const termId = termIds[cursor];
      cursor += 1;
      if (termId) await prepareAutoReview(termId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, termIds.length) }, () => worker()));
}

export async function prepareQueuedReviews(items: ReadonlyArray<{ termId: string; requestMode: ReviewRequestMode }>, concurrency = 2): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item) await processQueuedReview(item.termId, item.requestMode);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

/** 프로세스 중단으로 멈춘 작업을 되돌리고 아직 대기 중인 작업을 다시 처리한다. */
export async function resumeReviewQueue(): Promise<void> {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1_000);
  await getDb().update(aiReviewQueue).set({ status: "queued", startedAt: null, errorMessage: null }).where(and(
    eq(aiReviewQueue.status, "processing"),
    lt(aiReviewQueue.startedAt, staleBefore),
  ));
  const queued = await getDb().select({ termId: aiReviewQueue.termId, requestMode: aiReviewQueue.requestMode })
    .from(aiReviewQueue)
    .where(eq(aiReviewQueue.status, "queued"))
    .orderBy(asc(aiReviewQueue.requestedAt))
    .limit(100);
  await prepareQueuedReviews(queued);
}

export async function listReviewQueue(limit = 100): Promise<ReviewQueueSnapshot> {
  const [[counts], rows] = await Promise.all([
    getDb().select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where ${aiReviewQueue.status} = 'queued')::int`,
      processing: sql<number>`count(*) filter (where ${aiReviewQueue.status} = 'processing')::int`,
      ready: sql<number>`count(*) filter (where ${aiReviewQueue.status} = 'ready')::int`,
      failed: sql<number>`count(*) filter (where ${aiReviewQueue.status} = 'failed')::int`,
    }).from(aiReviewQueue),
    getDb().select({
      termId: aiReviewQueue.termId,
      revision: aiReviewQueue.revision,
      status: aiReviewQueue.status,
      requestMode: aiReviewQueue.requestMode,
      termSlug: terms.slug,
      nameEn: terms.nameEn,
      nameKo: terms.nameKo,
      requestedByName: users.name,
      requestedAt: aiReviewQueue.requestedAt,
      startedAt: aiReviewQueue.startedAt,
      finishedAt: aiReviewQueue.finishedAt,
      errorMessage: aiReviewQueue.errorMessage,
    }).from(aiReviewQueue)
      .innerJoin(terms, eq(terms.id, aiReviewQueue.termId))
      .leftJoin(users, eq(users.id, aiReviewQueue.requestedBy))
      .orderBy(desc(aiReviewQueue.requestedAt))
      .limit(limit),
  ]);
  const queued = counts?.queued ?? 0;
  const processing = counts?.processing ?? 0;
  return {
    counts: {
      total: counts?.total ?? 0,
      active: queued + processing,
      queued,
      processing,
      ready: counts?.ready ?? 0,
      failed: counts?.failed ?? 0,
    },
    items: rows.map((row) => ({
      termId: row.termId,
      revision: row.revision,
      status: row.status,
      requestMode: row.requestMode,
      termSlug: row.termSlug,
      termName: row.nameKo ?? row.nameEn ?? row.termSlug,
      requestedByName: row.requestedByName,
      requestedAt: row.requestedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
    })),
  };
}

export async function reviewQueueStatuses(termRevisions: ReadonlyArray<{ id: string; revision: number }>): Promise<Record<string, ReviewQueueStatus>> {
  if (termRevisions.length === 0) return {};
  const revisions = new Map(termRevisions.map((term) => [term.id, term.revision]));
  const rows = await getDb().select({ termId: aiReviewQueue.termId, revision: aiReviewQueue.revision, status: aiReviewQueue.status })
    .from(aiReviewQueue).where(inArray(aiReviewQueue.termId, [...revisions.keys()]));
  return Object.fromEntries(rows.filter((row) => revisions.get(row.termId) === row.revision).map((row) => [row.termId, row.status]));
}

export async function dismissPreparedSuggestion(termId: string, revision: number, suggestionId: string): Promise<boolean> {
  const review = await getPreparedReview(termId, revision);
  if (!review) return false;
  const suggestions = review.suggestions.filter((item) => item.id !== suggestionId);
  if (suggestions.length === review.suggestions.length) return false;
  await getDb().update(aiReviewSuggestions).set({ suggestions }).where(and(
    eq(aiReviewSuggestions.termId, termId),
    eq(aiReviewSuggestions.revision, revision),
  ));
  return true;
}

export async function decidePreparedRelationSuggestion(input: {
  termId: string;
  revision: number;
  suggestionId: string;
  decision: "approved" | "rejected";
  reviewedBy: string | null;
}): Promise<boolean> {
  const review = await getPreparedReview(input.termId, input.revision);
  const suggestion = review?.suggestions.find((item): item is RelationContributionSuggestion => (
    item.id === input.suggestionId && item.field === "relation"
  ));
  if (!review || !suggestion?.value.relationId) return false;
  const [relation] = await getDb().select().from(termRelations).where(eq(termRelations.id, suggestion.value.relationId)).limit(1);
  if (!relation || relation.status !== "proposed" || relation.sourceTermId !== input.termId) return false;
  if (relation.sourceRevision && await currentRevisionNumber(relation.sourceTermId) !== relation.sourceRevision) return false;
  if (relation.targetRevision && await currentRevisionNumber(relation.targetTermId) !== relation.targetRevision) return false;

  const remaining = review.suggestions.filter((item) => item.id !== input.suggestionId);
  return getDb().transaction(async (tx) => {
    const [updated] = await tx.update(termRelations).set({
      status: input.decision,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
    }).where(and(eq(termRelations.id, relation.id), eq(termRelations.status, "proposed"))).returning({ id: termRelations.id });
    if (!updated) return false;
    await tx.update(aiReviewSuggestions).set({ suggestions: remaining }).where(and(
      eq(aiReviewSuggestions.termId, input.termId),
      eq(aiReviewSuggestions.revision, input.revision),
    ));
    return true;
  });
}
