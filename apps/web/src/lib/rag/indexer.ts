import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, sql, type InferSelectModel } from "drizzle-orm";
import {
  ragDocuments,
  ragIndexQueue,
  ragConfig,
  termRevisions,
  termSurfaces,
  terms,
  meetingDocuments,
  meetingRagDocuments,
  meetingRagIndexQueue,
  wikiPages,
  wikiRagDocuments,
  wikiRagIndexQueue,
} from "@glossary/db";
import { getDb } from "@/lib/db";
import { AiProviderError } from "@/lib/ai/provider";
import { loadRagConfig, runtimeEmbeddingConfig, type RagDatabase } from "./config";
import { embedTexts } from "./provider";
import { RAG_VECTOR_DIMENSIONS } from "@glossary/db";
import type { AiRunContext } from "@/lib/ai/observability-values";

const MAX_EMBEDDING_BATCH = 96;
const ERROR_MAX_LENGTH = 1_000;

type RagTerm = InferSelectModel<typeof terms>;
type RagSurface = InferSelectModel<typeof termSurfaces>;
type RagConfigRow = InferSelectModel<typeof ragConfig>;

export interface RagChunk {
  chunkIndex: number;
  sourceField: "metadata" | "definition" | "body";
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

function normalized(value: string | null | undefined): string {
  return value?.replace(/\r\n?/g, "\n").trim() ?? "";
}

/** Splits on paragraph boundaries first and keeps a small character overlap for context. */
export function chunkRagText(text: string, chunkSize: number, overlap: number): string[] {
  const source = normalized(text);
  if (!source) return [];
  const size = Math.max(1, Math.min(8_000, Math.floor(chunkSize)));
  const safeOverlap = Math.max(0, Math.min(size - 1, Math.floor(overlap)));
  if (source.length <= size) return [source];

  const chunks: string[] = [];
  let start = 0;
  while (start < source.length) {
    const end = Math.min(source.length, start + size);
    let boundary = end;
    if (end < source.length) {
      const paragraph = source.lastIndexOf("\n\n", end);
      const line = source.lastIndexOf("\n", end);
      if (paragraph > start + Math.floor(size * 0.45)) boundary = paragraph;
      else if (line > start + Math.floor(size * 0.6)) boundary = line;
    }
    if (boundary <= start) boundary = end;
    const piece = source.slice(start, boundary).trim();
    if (piece) chunks.push(piece);
    if (boundary >= source.length) break;
    const next = Math.max(start + 1, boundary - safeOverlap);
    start = next;
  }
  return chunks;
}

function hashContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function displayName(term: Pick<RagTerm, "nameKo" | "nameEn">): string {
  return term.nameKo || term.nameEn || "이름 없는 용어";
}

function surfaceLine(surfaces: RagSurface[]): string {
  return surfaces.map((surface) => `${surface.text} (${surface.kind})`).join(", ");
}

function contextualChunks(
  text: string | null | undefined,
  title: string,
  label: "정의" | "본문",
  chunkSize: number,
  overlap: number,
): Array<{ sourceField: "definition" | "body"; text: string }> {
  const prefix = `용어 ${title.slice(0, 120)}의 ${label}:\n`;
  const bodySize = Math.max(1, chunkSize - prefix.length);
  const bodyOverlap = Math.min(Math.max(0, overlap), Math.max(0, bodySize - 1));
  const sourceField = label === "정의" ? "definition" as const : "body" as const;
  return chunkRagText(text ?? "", bodySize, bodyOverlap).map((chunk) => ({
    sourceField,
    text: `${prefix}${chunk}`,
  }));
}

export function buildRagChunks(
  term: RagTerm,
  surfaces: RagSurface[],
  revision: number,
  config: Pick<RagConfigRow, "chunkSize" | "chunkOverlap">,
): RagChunk[] {
  const title = displayName(term);
  const metadata = [
    `용어: ${title}`,
    `영문 표기: ${term.nameEn ?? ""}`,
    `한글 표기: ${term.nameKo ?? ""}`,
    `영문 확장명: ${term.fullNameEn ?? ""}`,
    `한글 확장명: ${term.fullNameKo ?? ""}`,
    `추가 표기: ${surfaceLine(surfaces)}`,
    `도메인: ${term.domain.join(", ")}`,
    `업무 분류: ${term.category.join(", ")}`,
    `태그: ${term.tags.join(", ")}`,
    `상태: ${term.status}`,
  ].filter((line) => line.split(": ").at(1)).join("\n");

  const raw: Array<{ sourceField: RagChunk["sourceField"]; text: string }> = [
    ...chunkRagText(metadata, config.chunkSize, config.chunkOverlap).map((text) => ({ sourceField: "metadata" as const, text })),
    ...contextualChunks(term.definitionMd, title, "정의", config.chunkSize, config.chunkOverlap),
    ...contextualChunks(term.bodyMd, title, "본문", config.chunkSize, config.chunkOverlap),
  ];

  return raw.map((chunk, chunkIndex) => ({
    chunkIndex,
    sourceField: chunk.sourceField,
    content: chunk.text,
    contentHash: hashContent(`${term.id}:${revision}:${chunkIndex}:${chunk.text}`),
    metadata: {
      termId: term.id,
      slug: term.slug,
      title,
      revision,
      sourceField: chunk.sourceField,
    },
  }));
}

/** Queues a term in the same transaction as its term/revision write. */
export async function queueRagIndex(
  database: RagDatabase,
  termId: string,
  revision: number,
): Promise<void> {
  const now = new Date();
  await database.insert(ragIndexQueue).values({
    termId,
    revision,
    status: "queued",
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).onConflictDoUpdate({
    target: ragIndexQueue.termId,
    set: {
      revision,
      status: "queued",
      requestedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
}

/**
 * Queue writes are durable. A dedicated worker polls them, so a web request
 * never owns embedding work after its response has been sent.
 */
export function scheduleRagIndexing(_limit = 8): void {
  // Kept as a compatibility shim for existing mutation paths. The enqueue
  // already happened in the transaction; the worker is responsible for drain.
}

/** Requeues every non-merged term. Used after changing the embedding model/settings. */
export async function queueAllRagTerms(): Promise<number> {
  const db = getDb();
  const rows = await db.select({
    id: terms.id,
    revision: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int`,
  }).from(terms)
    .leftJoin(termRevisions, eq(termRevisions.termId, terms.id))
    .where(sql`${terms.replacedById} is null`)
    .groupBy(terms.id);
  const pending = rows.filter((row) => row.revision > 0);
  if (pending.length === 0) return 0;
  const now = new Date();
  await db.insert(ragIndexQueue).values(pending.map((row) => ({
    termId: row.id,
    revision: row.revision,
    status: "queued" as const,
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }))).onConflictDoUpdate({
    target: ragIndexQueue.termId,
    set: {
      revision: sql.raw("excluded.revision"),
      status: "queued",
      requestedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
  return pending.length;
}

async function currentRevision(database: RagDatabase, termId: string): Promise<number> {
  const [row] = await database.select({ revision: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
    .from(termRevisions).where(eq(termRevisions.termId, termId));
  return row?.revision ?? 0;
}

async function claimNextJob(): Promise<InferSelectModel<typeof ragIndexQueue> | null> {
  const db = getDb();
  const [candidate] = await db.select().from(ragIndexQueue)
    .where(eq(ragIndexQueue.status, "queued"))
    .orderBy(asc(ragIndexQueue.requestedAt))
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db.update(ragIndexQueue).set({
    status: "processing",
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  }).where(and(eq(ragIndexQueue.termId, candidate.termId), eq(ragIndexQueue.status, "queued"))).returning();
  return claimed ?? null;
}

/** A crashed request must not leave a durable job permanently invisible to the worker. */
async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000);
  await getDb().update(ragIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: "중단된 색인 작업을 다시 대기열에 넣었습니다.",
  }).where(and(
    eq(ragIndexQueue.status, "processing"),
    lt(ragIndexQueue.startedAt, staleBefore),
  ));
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "RAG 색인에 실패했습니다.";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, ERROR_MAX_LENGTH);
}

function sameIndexConfig(left: RagConfigRow, right: RagConfigRow): boolean {
  return left.enabled === right.enabled
    && left.embeddingProvider === right.embeddingProvider
    && left.embeddingBaseUrl === right.embeddingBaseUrl
    && left.embeddingModel === right.embeddingModel
    && left.embeddingApiKeyEncrypted === right.embeddingApiKeyEncrypted
    && left.embeddingCustomHeadersEncrypted === right.embeddingCustomHeadersEncrypted
    && left.chunkSize === right.chunkSize
    && left.chunkOverlap === right.chunkOverlap;
}

async function releaseClaimedJob(job: InferSelectModel<typeof ragIndexQueue>): Promise<void> {
  await getDb().update(ragIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).where(and(
    eq(ragIndexQueue.termId, job.termId),
    eq(ragIndexQueue.revision, job.revision),
    eq(ragIndexQueue.status, "processing"),
    eq(ragIndexQueue.requestedAt, job.requestedAt),
  ));
}

async function indexJob(job: InferSelectModel<typeof ragIndexQueue>, config: RagConfigRow, telemetry: AiRunContext): Promise<void> {
  const db = getDb();
  const [term] = await db.select().from(terms).where(eq(terms.id, job.termId)).limit(1);
  if (!term || term.replacedById) {
    await db.delete(ragDocuments).where(eq(ragDocuments.termId, job.termId));
    await db.delete(ragIndexQueue).where(eq(ragIndexQueue.termId, job.termId));
    return;
  }
  const revision = await currentRevision(db, term.id);
  if (revision !== job.revision) {
    await queueRagIndex(db, term.id, revision);
    return;
  }
  const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
  const chunks = buildRagChunks(term, surfaces, revision, config);
  const embeddingConfig = runtimeEmbeddingConfig(config);
  const embeddings: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += MAX_EMBEDDING_BATCH) {
    const batch = chunks.slice(offset, offset + MAX_EMBEDDING_BATCH);
    embeddings.push(...await embedTexts(embeddingConfig, batch.map((chunk) => chunk.content), { ...telemetry, operation: "rag.embedding.index" }));
  }
  if (embeddings.length !== chunks.length) throw new AiProviderError("Embedding 결과 수가 색인 청크 수와 다릅니다.");
  if (embeddings.some((embedding) => embedding.length !== RAG_VECTOR_DIMENSIONS)) {
    throw new AiProviderError(`Embedding 차원은 ${RAG_VECTOR_DIMENSIONS}이어야 합니다.`);
  }

  await db.transaction(async (tx) => {
    const latest = await currentRevision(tx, term.id);
    const [currentTerm] = await tx.select({ replacedById: terms.replacedById }).from(terms)
      .where(eq(terms.id, term.id)).limit(1);
    const [currentConfig] = await tx.select().from(ragConfig)
      .where(eq(ragConfig.id, config.id)).limit(1);
    const [currentJob] = await tx.select({
      revision: ragIndexQueue.revision,
      status: ragIndexQueue.status,
      requestedAt: ragIndexQueue.requestedAt,
    }).from(ragIndexQueue)
      .where(eq(ragIndexQueue.termId, term.id)).limit(1);
    const jobIsCurrent = currentJob?.revision === job.revision
      && currentJob.status === "processing"
      && currentJob.requestedAt.getTime() === job.requestedAt.getTime();
    if (!currentTerm || currentTerm.replacedById) {
      if (jobIsCurrent) {
        await tx.delete(ragDocuments).where(eq(ragDocuments.termId, term.id));
        await tx.delete(ragIndexQueue).where(eq(ragIndexQueue.termId, term.id));
      }
      return;
    }
    if (!jobIsCurrent) return;
    if (latest !== revision) {
      await queueRagIndex(tx, term.id, latest);
      return;
    }
    if (!currentConfig || !sameIndexConfig(currentConfig, config)) {
      await tx.update(ragIndexQueue).set({
        status: "queued",
        requestedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
      }).where(and(
        eq(ragIndexQueue.termId, term.id),
        eq(ragIndexQueue.revision, job.revision),
        eq(ragIndexQueue.status, "processing"),
        eq(ragIndexQueue.requestedAt, job.requestedAt),
      ));
      return;
    }
    await tx.delete(ragDocuments).where(eq(ragDocuments.termId, term.id));
    await tx.insert(ragDocuments).values(chunks.map((chunk, index) => ({
      termId: term.id,
      revision,
      chunkIndex: chunk.chunkIndex,
      sourceField: chunk.sourceField,
      content: chunk.content,
      contentHash: chunk.contentHash,
      metadata: chunk.metadata,
      embedding: embeddings[index]!,
    })));
    await tx.update(ragIndexQueue).set({
      status: "ready",
      finishedAt: new Date(),
      errorMessage: null,
    }).where(and(
      eq(ragIndexQueue.termId, term.id),
      eq(ragIndexQueue.revision, job.revision),
      eq(ragIndexQueue.status, "processing"),
      eq(ragIndexQueue.requestedAt, job.requestedAt),
    ));
  });
}

/** Processes a bounded number of durable jobs so one request cannot run forever. */
export async function processRagIndexQueue(limit = 8): Promise<number> {
  await recoverStaleJobs();
  let attempted = 0;
  for (let index = 0; index < Math.max(0, Math.min(32, limit)); index += 1) {
    const job = await claimNextJob();
    if (!job) break;
    attempted += 1;
    try {
      // Read the configuration after claiming the job. An administrator can
      // change the embedding model between queue polling and the claim, and
      // the next job must not use the previous provider settings.
      const configured = await loadRagConfig();
      if (!configured.enabled) {
        await releaseClaimedJob(job);
        return attempted;
      }
      await indexJob(job, configured, {
        traceId: randomUUID(),
        metadata: { termId: job.termId, revision: job.revision },
      });
    } catch (error) {
      await getDb().update(ragIndexQueue).set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: errorMessage(error),
      }).where(and(
        eq(ragIndexQueue.termId, job.termId),
        eq(ragIndexQueue.revision, job.revision),
        eq(ragIndexQueue.status, "processing"),
        eq(ragIndexQueue.requestedAt, job.requestedAt),
      ));
    }
  }
  return attempted;
}

export async function getRagIndexStats(): Promise<import("./config-values").RagIndexStats> {
  const db = getDb();
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(terms).where(sql`${terms.replacedById} is null`);
  const [meetingTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(meetingDocuments).where(eq(meetingDocuments.status, "active"));
  const [wikiTotal] = await db.select({ count: sql<number>`count(*)::int` }).from(wikiPages).where(eq(wikiPages.status, "published"));
  const [indexed] = await db.select({
    terms: sql<number>`count(distinct ${ragDocuments.termId})::int`,
    chunks: sql<number>`count(*)::int`,
  }).from(ragDocuments)
    .innerJoin(terms, eq(terms.id, ragDocuments.termId))
    .innerJoin(ragIndexQueue, and(
      eq(ragIndexQueue.termId, ragDocuments.termId),
      eq(ragIndexQueue.revision, ragDocuments.revision),
      eq(ragIndexQueue.status, "ready"),
    )).where(and(
      sql`${terms.replacedById} is null`,
      sql`${ragDocuments.revision} = (select coalesce(max(tr.revision_number), 0) from term_revisions tr where tr.term_id = ${terms.id})`,
    ));
  const [meetingIndexed] = await db.select({
    meetings: sql<number>`count(distinct ${meetingRagDocuments.meetingDocumentId})::int`,
    chunks: sql<number>`count(*)::int`,
  }).from(meetingRagDocuments)
    .innerJoin(meetingDocuments, eq(meetingDocuments.id, meetingRagDocuments.meetingDocumentId))
    .innerJoin(meetingRagIndexQueue, and(
      eq(meetingRagIndexQueue.meetingDocumentId, meetingRagDocuments.meetingDocumentId),
      eq(meetingRagIndexQueue.revision, meetingRagDocuments.revision),
      eq(meetingRagIndexQueue.status, "ready"),
    )).where(and(
      eq(meetingDocuments.status, "active"),
      sql`${meetingRagDocuments.revision} = ${meetingDocuments.revision}`,
    ));
  const [wikiIndexed] = await db.select({
    pages: sql<number>`count(distinct ${wikiRagDocuments.wikiPageId})::int`,
    chunks: sql<number>`count(*)::int`,
  }).from(wikiRagDocuments)
    .innerJoin(wikiPages, eq(wikiPages.id, wikiRagDocuments.wikiPageId))
    .innerJoin(wikiRagIndexQueue, and(
      eq(wikiRagIndexQueue.wikiPageId, wikiRagDocuments.wikiPageId),
      eq(wikiRagIndexQueue.revision, wikiRagDocuments.revision),
      eq(wikiRagIndexQueue.status, "ready"),
    )).where(and(
      eq(wikiPages.status, "published"),
      sql`${wikiRagDocuments.revision} = ${wikiPages.revision}`,
    ));
  const queueRows = await db.select({ status: ragIndexQueue.status, count: sql<number>`count(*)::int` })
    .from(ragIndexQueue)
    .innerJoin(terms, eq(terms.id, ragIndexQueue.termId))
    .where(sql`${terms.replacedById} is null`)
    .groupBy(ragIndexQueue.status);
  const meetingQueueRows = await db.select({ status: meetingRagIndexQueue.status, count: sql<number>`count(*)::int` })
    .from(meetingRagIndexQueue)
    .innerJoin(meetingDocuments, eq(meetingDocuments.id, meetingRagIndexQueue.meetingDocumentId))
    .where(eq(meetingDocuments.status, "active"))
    .groupBy(meetingRagIndexQueue.status);
  const wikiQueueRows = await db.select({ status: wikiRagIndexQueue.status, count: sql<number>`count(*)::int` })
    .from(wikiRagIndexQueue)
    .innerJoin(wikiPages, eq(wikiPages.id, wikiRagIndexQueue.wikiPageId))
    .where(eq(wikiPages.status, "published"))
    .groupBy(wikiRagIndexQueue.status);
  const counts = new Map<string, number>();
  for (const row of [...queueRows, ...meetingQueueRows, ...wikiQueueRows]) counts.set(row.status, (counts.get(row.status) ?? 0) + row.count);
  const [last] = await db.select({ value: sql<Date | null>`max(${ragDocuments.createdAt})` }).from(ragDocuments)
    .innerJoin(terms, eq(terms.id, ragDocuments.termId))
    .innerJoin(ragIndexQueue, and(
      eq(ragIndexQueue.termId, ragDocuments.termId),
      eq(ragIndexQueue.revision, ragDocuments.revision),
      eq(ragIndexQueue.status, "ready"),
    )).where(and(
      sql`${terms.replacedById} is null`,
      sql`${ragDocuments.revision} = (select coalesce(max(tr.revision_number), 0) from term_revisions tr where tr.term_id = ${terms.id})`,
    ));
  return {
    totalTerms: total?.count ?? 0,
    indexedTerms: indexed?.terms ?? 0,
    indexedChunks: indexed?.chunks ?? 0,
    totalMeetings: meetingTotal?.count ?? 0,
    indexedMeetings: meetingIndexed?.meetings ?? 0,
    meetingIndexedChunks: meetingIndexed?.chunks ?? 0,
    totalWikiPages: wikiTotal?.count ?? 0,
    indexedWikiPages: wikiIndexed?.pages ?? 0,
    wikiIndexedChunks: wikiIndexed?.chunks ?? 0,
    queued: counts.get("queued") ?? 0,
    processing: counts.get("processing") ?? 0,
    ready: counts.get("ready") ?? 0,
    failed: counts.get("failed") ?? 0,
    lastIndexedAt: last?.value ? new Date(last.value).toISOString() : null,
  };
}
