import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql, type InferSelectModel } from "drizzle-orm";
import { ragConfig, RAG_VECTOR_DIMENSIONS, terms, wikiPageTerms, wikiPages, wikiRagDocuments, wikiRagIndexQueue } from "@glossary/db";
import { scheduleAfterResponse } from "@/lib/after-response";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiRunContext } from "@/lib/ai/observability-values";
import { getDb } from "@/lib/db";
import { loadRagConfig, runtimeEmbeddingConfig, type RagDatabase } from "./config";
import { embedTexts } from "./provider";

const MAX_EMBEDDING_BATCH = 96;
const MAX_BACKGROUND_BATCHES = 128;
const ERROR_MAX_LENGTH = 1_000;

type WikiPage = InferSelectModel<typeof wikiPages>;
type WikiConfigRow = InferSelectModel<typeof ragConfig>;
type WikiQueueRow = InferSelectModel<typeof wikiRagIndexQueue>;

export interface WikiRagChunk {
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

/** 원문의 문자 위치를 보존하고 문단·줄 경계를 우선해 위키를 나눈다. */
export function chunkWikiText(text: string, chunkSize: number, overlap: number): Array<{ content: string; startOffset: number; endOffset: number }> {
  if (!text.trim()) return [];
  const size = Math.max(1, Math.min(8_000, Math.floor(chunkSize)));
  const safeOverlap = Math.max(0, Math.min(size - 1, Math.floor(overlap)));
  const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    let boundary = end;
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const line = text.lastIndexOf("\n", end);
      if (paragraph > start + Math.floor(size * 0.45)) boundary = paragraph;
      else if (line > start + Math.floor(size * 0.6)) boundary = line;
    }
    if (boundary <= start) boundary = end;
    const raw = text.slice(start, boundary);
    const leading = raw.search(/\S/);
    const trimmedStart = leading < 0 ? start : start + leading;
    const trailing = raw.match(/\s+$/)?.[0].length ?? 0;
    const trimmedEnd = Math.max(trimmedStart, boundary - trailing);
    if (trimmedEnd > trimmedStart) chunks.push({
      content: text.slice(trimmedStart, trimmedEnd),
      startOffset: trimmedStart,
      endOffset: trimmedEnd,
    });
    if (boundary >= text.length) break;
    start = Math.max(start + 1, boundary - safeOverlap);
  }
  return chunks;
}

function hashContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildWikiRagChunks(
  page: Pick<WikiPage, "id" | "slug" | "title" | "summary" | "domain" | "content" | "revision"> & { sourceUrl?: string | null; termTitles?: string[] },
  config: Pick<WikiConfigRow, "chunkSize" | "chunkOverlap">,
): WikiRagChunk[] {
  const fullPrefix = [
    `위키 문서: ${page.title}`,
    `주소: /w/${page.slug}`,
    `요약: ${page.summary ?? ""}`,
    `도메인: ${page.domain.join(", ")}`,
    `연결 용어: ${(page.termTitles ?? []).join(", ")}`,
  ].filter((line) => line.split(": ").at(1)).join("\n");
  const prefix = fullPrefix.slice(0, Math.min(fullPrefix.length, Math.floor(config.chunkSize * 0.35)));
  const bodySize = Math.max(1, config.chunkSize - prefix.length - 1);
  const rawChunks = chunkWikiText(page.content, bodySize, Math.min(config.chunkOverlap, Math.max(0, bodySize - 1)));
  return rawChunks.map((chunk, chunkIndex) => {
    const content = `${prefix}\n${chunk.content}`;
    return {
      chunkIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      content,
      contentHash: hashContent(`${page.id}:${page.revision}:${chunkIndex}:${content}`),
      metadata: {
        wikiPageId: page.id,
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        sourceUrl: page.sourceUrl,
        domain: page.domain,
        termTitles: page.termTitles ?? [],
        revision: page.revision,
      },
    };
  });
}

/** 위키 저장 트랜잭션 안에서 호출하는 최신 revision 대기열 등록. */
export async function queueWikiIndex(database: RagDatabase, wikiPageId: string, revision: number): Promise<void> {
  const now = new Date();
  await database.insert(wikiRagIndexQueue).values({
    wikiPageId,
    revision,
    status: "queued",
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).onConflictDoUpdate({
    target: wikiRagIndexQueue.wikiPageId,
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

export function scheduleWikiRagIndexing(limit = 4): void {
  scheduleAfterResponse(async () => {
    const batchSize = Math.max(1, Math.min(32, Math.floor(limit)));
    for (let batch = 0; batch < MAX_BACKGROUND_BATCHES; batch += 1) {
      const attempted = await processWikiRagIndexQueue(batchSize);
      if (attempted < batchSize) break;
    }
  });
}

/** Embedding 설정이 바뀌었을 때 공개 위키만 다시 색인한다. */
export async function queueAllWikiPages(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: wikiPages.id, revision: wikiPages.revision })
    .from(wikiPages).where(eq(wikiPages.status, "published"));
  if (rows.length === 0) return 0;
  const now = new Date();
  await db.insert(wikiRagIndexQueue).values(rows.map((row) => ({
    wikiPageId: row.id,
    revision: row.revision,
    status: "queued" as const,
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }))).onConflictDoUpdate({
    target: wikiRagIndexQueue.wikiPageId,
    set: {
      revision: sql.raw("excluded.revision"),
      status: "queued",
      requestedAt: now,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
  return rows.length;
}

async function claimNextWikiJob(): Promise<WikiQueueRow | null> {
  const db = getDb();
  const [candidate] = await db.select().from(wikiRagIndexQueue)
    .where(eq(wikiRagIndexQueue.status, "queued"))
    .orderBy(asc(wikiRagIndexQueue.requestedAt))
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db.update(wikiRagIndexQueue).set({
    status: "processing",
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  }).where(and(
    eq(wikiRagIndexQueue.wikiPageId, candidate.wikiPageId),
    eq(wikiRagIndexQueue.status, "queued"),
  )).returning();
  return claimed ?? null;
}

async function recoverStaleWikiJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000);
  await getDb().update(wikiRagIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: "중단된 위키 색인 작업을 다시 대기열에 넣었습니다.",
  }).where(and(
    eq(wikiRagIndexQueue.status, "processing"),
    lt(wikiRagIndexQueue.startedAt, staleBefore),
  ));
}

function providerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "위키 RAG 색인에 실패했습니다.";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, ERROR_MAX_LENGTH);
}

function sameIndexConfig(left: WikiConfigRow, right: WikiConfigRow): boolean {
  return left.enabled === right.enabled
    && left.embeddingProvider === right.embeddingProvider
    && left.embeddingBaseUrl === right.embeddingBaseUrl
    && left.embeddingModel === right.embeddingModel
    && left.embeddingApiKeyEncrypted === right.embeddingApiKeyEncrypted
    && left.embeddingCustomHeadersEncrypted === right.embeddingCustomHeadersEncrypted
    && left.chunkSize === right.chunkSize
    && left.chunkOverlap === right.chunkOverlap;
}

async function releaseClaimedWikiJob(job: WikiQueueRow): Promise<void> {
  await getDb().update(wikiRagIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).where(and(
    eq(wikiRagIndexQueue.wikiPageId, job.wikiPageId),
    eq(wikiRagIndexQueue.revision, job.revision),
    eq(wikiRagIndexQueue.status, "processing"),
    eq(wikiRagIndexQueue.requestedAt, job.requestedAt),
  ));
}

async function indexWikiJob(job: WikiQueueRow, config: WikiConfigRow, telemetry: AiRunContext): Promise<void> {
  const db = getDb();
  const [page] = await db.select().from(wikiPages).where(eq(wikiPages.id, job.wikiPageId)).limit(1);
  if (!page) {
    await db.delete(wikiRagDocuments).where(eq(wikiRagDocuments.wikiPageId, job.wikiPageId));
    await db.delete(wikiRagIndexQueue).where(eq(wikiRagIndexQueue.wikiPageId, job.wikiPageId));
    return;
  }
  if (page.revision !== job.revision) {
    await queueWikiIndex(db, page.id, page.revision);
    return;
  }

  const termTitles = page.status === "published"
    ? (await db.select({ nameKo: terms.nameKo, nameEn: terms.nameEn })
      .from(wikiPageTerms)
      .innerJoin(terms, eq(terms.id, wikiPageTerms.termId))
      .where(eq(wikiPageTerms.wikiPageId, page.id)))
      .map((term) => term.nameKo || term.nameEn || "이름 없는 용어")
    : [];
  const chunks = page.status === "published" ? buildWikiRagChunks({ ...page, termTitles }, config) : [];
  if (chunks.length === 0) {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(wikiPages).where(eq(wikiPages.id, page.id)).limit(1);
      const [currentJob] = await tx.select({ revision: wikiRagIndexQueue.revision, status: wikiRagIndexQueue.status, requestedAt: wikiRagIndexQueue.requestedAt })
        .from(wikiRagIndexQueue).where(eq(wikiRagIndexQueue.wikiPageId, page.id)).limit(1);
      if (!current || currentJob?.revision !== job.revision || currentJob.status !== "processing" || currentJob.requestedAt.getTime() !== job.requestedAt.getTime()) return;
      if (current.revision !== job.revision) {
        await queueWikiIndex(tx, current.id, current.revision);
        return;
      }
      await tx.delete(wikiRagDocuments).where(eq(wikiRagDocuments.wikiPageId, page.id));
      await tx.update(wikiRagIndexQueue).set({ status: "ready", finishedAt: new Date(), errorMessage: null }).where(and(
        eq(wikiRagIndexQueue.wikiPageId, page.id),
        eq(wikiRagIndexQueue.revision, job.revision),
        eq(wikiRagIndexQueue.status, "processing"),
        eq(wikiRagIndexQueue.requestedAt, job.requestedAt),
      ));
    });
    return;
  }

  const embeddingConfig = runtimeEmbeddingConfig(config);
  const embeddings: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += MAX_EMBEDDING_BATCH) {
    const batch = chunks.slice(offset, offset + MAX_EMBEDDING_BATCH);
    embeddings.push(...await embedTexts(embeddingConfig, batch.map((chunk) => chunk.content), { ...telemetry, operation: "rag.embedding.wiki-index" }));
  }
  if (embeddings.length !== chunks.length) throw new AiProviderError("위키 Embedding 결과 수가 색인 청크 수와 다릅니다.");
  if (embeddings.some((embedding) => embedding.length !== RAG_VECTOR_DIMENSIONS)) {
    throw new AiProviderError(`Embedding 차원은 ${RAG_VECTOR_DIMENSIONS}이어야 합니다.`);
  }

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(wikiPages).where(eq(wikiPages.id, page.id)).limit(1);
    const [currentConfig] = await tx.select().from(ragConfig).where(eq(ragConfig.id, config.id)).limit(1);
    const [currentJob] = await tx.select({ revision: wikiRagIndexQueue.revision, status: wikiRagIndexQueue.status, requestedAt: wikiRagIndexQueue.requestedAt })
      .from(wikiRagIndexQueue).where(eq(wikiRagIndexQueue.wikiPageId, page.id)).limit(1);
    const jobIsCurrent = currentJob?.revision === job.revision
      && currentJob.status === "processing"
      && currentJob.requestedAt.getTime() === job.requestedAt.getTime();
    if (!current || !jobIsCurrent) return;
    if (current.revision !== job.revision) {
      await queueWikiIndex(tx, current.id, current.revision);
      return;
    }
    if (!currentConfig || !sameIndexConfig(currentConfig, config) || current.status !== "published") {
      await tx.update(wikiRagIndexQueue).set({ status: "queued", requestedAt: new Date(), startedAt: null, finishedAt: null, errorMessage: null }).where(and(
        eq(wikiRagIndexQueue.wikiPageId, page.id),
        eq(wikiRagIndexQueue.revision, job.revision),
        eq(wikiRagIndexQueue.status, "processing"),
        eq(wikiRagIndexQueue.requestedAt, job.requestedAt),
      ));
      return;
    }
    await tx.delete(wikiRagDocuments).where(eq(wikiRagDocuments.wikiPageId, page.id));
    await tx.insert(wikiRagDocuments).values(chunks.map((chunk, index) => ({
      wikiPageId: page.id,
      revision: page.revision,
      chunkIndex: chunk.chunkIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      content: chunk.content,
      contentHash: chunk.contentHash,
      metadata: chunk.metadata,
      embedding: embeddings[index]!,
    })));
    await tx.update(wikiRagIndexQueue).set({ status: "ready", finishedAt: new Date(), errorMessage: null }).where(and(
      eq(wikiRagIndexQueue.wikiPageId, page.id),
      eq(wikiRagIndexQueue.revision, job.revision),
      eq(wikiRagIndexQueue.status, "processing"),
      eq(wikiRagIndexQueue.requestedAt, job.requestedAt),
    ));
  });
}

export async function processWikiRagIndexQueue(limit = 8): Promise<number> {
  await recoverStaleWikiJobs();
  let attempted = 0;
  for (let index = 0; index < Math.max(0, Math.min(32, limit)); index += 1) {
    const job = await claimNextWikiJob();
    if (!job) break;
    attempted += 1;
    try {
      const configured = await loadRagConfig();
      if (!configured.enabled) {
        await releaseClaimedWikiJob(job);
        return attempted;
      }
      await indexWikiJob(job, configured, {
        traceId: randomUUID(),
        metadata: { wikiPageId: job.wikiPageId, revision: job.revision },
      });
    } catch (error) {
      await getDb().update(wikiRagIndexQueue).set({ status: "failed", finishedAt: new Date(), errorMessage: providerErrorMessage(error) }).where(and(
        eq(wikiRagIndexQueue.wikiPageId, job.wikiPageId),
        eq(wikiRagIndexQueue.revision, job.revision),
        eq(wikiRagIndexQueue.status, "processing"),
        eq(wikiRagIndexQueue.requestedAt, job.requestedAt),
      ));
    }
  }
  return attempted;
}
