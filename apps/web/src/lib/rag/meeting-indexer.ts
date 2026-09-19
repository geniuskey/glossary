import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql, type InferSelectModel } from "drizzle-orm";
import { meetingDocuments, meetingRagDocuments, meetingRagIndexQueue, ragConfig, RAG_VECTOR_DIMENSIONS } from "@glossary/db";
import { getDb } from "@/lib/db";
import { AiProviderError } from "@/lib/ai/provider";
import { loadRagConfig, runtimeEmbeddingConfig, type RagDatabase } from "./config";
import { embedTexts } from "./provider";
import type { AiRunContext } from "@/lib/ai/observability-values";

const MAX_EMBEDDING_BATCH = 96;
const ERROR_MAX_LENGTH = 1_000;

type MeetingDocument = InferSelectModel<typeof meetingDocuments>;
type MeetingConfigRow = InferSelectModel<typeof ragConfig>;
type MeetingQueueRow = InferSelectModel<typeof meetingRagIndexQueue>;

export interface MeetingRagChunk {
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

/** 원문의 문자 위치를 유지한 채 paragraph/line 경계를 우선해 회의록을 나눈다. */
export function chunkMeetingText(text: string, chunkSize: number, overlap: number): Array<{ content: string; startOffset: number; endOffset: number }> {
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

function dateLabel(date: Date | null): string {
  return date?.toISOString() ?? "";
}

export function buildMeetingRagChunks(
  document: Pick<MeetingDocument, "id" | "title" | "meetingDate" | "source" | "team" | "domain" | "content" | "revision">,
  config: Pick<MeetingConfigRow, "chunkSize" | "chunkOverlap">,
): MeetingRagChunk[] {
  const fullPrefix = [
    `회의록: ${document.title}`,
    `회의 일시: ${dateLabel(document.meetingDate)}`,
    `출처: ${document.source}`,
    `팀: ${document.team}`,
    `도메인: ${document.domain.join(", ")}`,
  ].filter((line) => line.split(": ").at(1)).join("\n");
  // Keep enough room for actual transcript text even when the title and
  // metadata are long. The complete metadata remains in the document row.
  const prefix = fullPrefix.slice(0, Math.min(fullPrefix.length, Math.floor(config.chunkSize * 0.35)));
  const bodySize = Math.max(1, config.chunkSize - prefix.length - 1);
  const rawChunks = chunkMeetingText(document.content, bodySize, Math.min(config.chunkOverlap, Math.max(0, bodySize - 1)));
  return rawChunks.map((chunk, chunkIndex) => {
    const content = `${prefix}\n${chunk.content}`;
    return {
      chunkIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      content,
      contentHash: hashContent(`${document.id}:${document.revision}:${chunkIndex}:${content}`),
      metadata: {
        meetingDocumentId: document.id,
        title: document.title,
        meetingDate: dateLabel(document.meetingDate),
        source: document.source,
        team: document.team,
        domain: document.domain,
        revision: document.revision,
      },
    };
  });
}

/** 회의록 저장/수정 트랜잭션 안에서 호출하는 최신 revision 대기열 등록. */
export async function queueMeetingIndex(database: RagDatabase, meetingDocumentId: string, revision: number): Promise<void> {
  const now = new Date();
  await database.insert(meetingRagIndexQueue).values({
    meetingDocumentId,
    revision,
    status: "queued",
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).onConflictDoUpdate({
    target: meetingRagIndexQueue.meetingDocumentId,
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

export function scheduleMeetingRagIndexing(limit = 4): void {
  void limit;
}

/** Embedding 설정이 바뀌었을 때 활성 회의록도 같은 모델로 다시 색인한다. */
export async function queueAllMeetingDocuments(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: meetingDocuments.id, revision: meetingDocuments.revision })
    .from(meetingDocuments).where(eq(meetingDocuments.status, "active"));
  if (rows.length === 0) return 0;
  const now = new Date();
  await db.insert(meetingRagIndexQueue).values(rows.map((row) => ({
    meetingDocumentId: row.id,
    revision: row.revision,
    status: "queued" as const,
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }))).onConflictDoUpdate({
    target: meetingRagIndexQueue.meetingDocumentId,
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

async function claimNextMeetingJob(): Promise<MeetingQueueRow | null> {
  const db = getDb();
  const [candidate] = await db.select().from(meetingRagIndexQueue)
    .where(eq(meetingRagIndexQueue.status, "queued"))
    .orderBy(asc(meetingRagIndexQueue.requestedAt))
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db.update(meetingRagIndexQueue).set({
    status: "processing",
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  }).where(and(
    eq(meetingRagIndexQueue.meetingDocumentId, candidate.meetingDocumentId),
    eq(meetingRagIndexQueue.status, "queued"),
  )).returning();
  return claimed ?? null;
}

async function recoverStaleMeetingJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000);
  await getDb().update(meetingRagIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: "중단된 회의록 색인 작업을 다시 대기열에 넣었습니다.",
  }).where(and(
    eq(meetingRagIndexQueue.status, "processing"),
    lt(meetingRagIndexQueue.startedAt, staleBefore),
  ));
}

function providerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "회의록 RAG 색인에 실패했습니다.";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, ERROR_MAX_LENGTH);
}

function sameIndexConfig(left: MeetingConfigRow, right: MeetingConfigRow): boolean {
  return left.enabled === right.enabled
    && left.embeddingProvider === right.embeddingProvider
    && left.embeddingBaseUrl === right.embeddingBaseUrl
    && left.embeddingModel === right.embeddingModel
    && left.embeddingApiKeyEncrypted === right.embeddingApiKeyEncrypted
    && left.embeddingCustomHeadersEncrypted === right.embeddingCustomHeadersEncrypted
    && left.chunkSize === right.chunkSize
    && left.chunkOverlap === right.chunkOverlap;
}

async function releaseClaimedMeetingJob(job: MeetingQueueRow): Promise<void> {
  await getDb().update(meetingRagIndexQueue).set({
    status: "queued",
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }).where(and(
    eq(meetingRagIndexQueue.meetingDocumentId, job.meetingDocumentId),
    eq(meetingRagIndexQueue.revision, job.revision),
    eq(meetingRagIndexQueue.status, "processing"),
    eq(meetingRagIndexQueue.requestedAt, job.requestedAt),
  ));
}

async function indexMeetingJob(job: MeetingQueueRow, config: MeetingConfigRow, telemetry: AiRunContext): Promise<void> {
  const db = getDb();
  const [document] = await db.select().from(meetingDocuments)
    .where(eq(meetingDocuments.id, job.meetingDocumentId)).limit(1);
  if (!document) {
    await db.delete(meetingRagDocuments).where(eq(meetingRagDocuments.meetingDocumentId, job.meetingDocumentId));
    await db.delete(meetingRagIndexQueue).where(eq(meetingRagIndexQueue.meetingDocumentId, job.meetingDocumentId));
    return;
  }
  if (document.revision !== job.revision) {
    await queueMeetingIndex(db, document.id, document.revision);
    return;
  }
  // 보관된 문서는 원문을 보존하되 검색 인덱스에서는 제외한다.
  const chunks = document.status === "active" ? buildMeetingRagChunks(document, config) : [];
  const embeddingConfig = runtimeEmbeddingConfig(config);
  const embeddings: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += MAX_EMBEDDING_BATCH) {
    const batch = chunks.slice(offset, offset + MAX_EMBEDDING_BATCH);
    embeddings.push(...await embedTexts(embeddingConfig, batch.map((chunk) => chunk.content), { ...telemetry, operation: "rag.embedding.meeting-index" }));
  }
  if (embeddings.length !== chunks.length) throw new AiProviderError("회의록 Embedding 결과 수가 색인 청크 수와 다릅니다.");
  if (embeddings.some((embedding) => embedding.length !== RAG_VECTOR_DIMENSIONS)) {
    throw new AiProviderError(`Embedding 차원은 ${RAG_VECTOR_DIMENSIONS}이어야 합니다.`);
  }

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(meetingDocuments).where(eq(meetingDocuments.id, document.id)).limit(1);
    const [currentConfig] = await tx.select().from(ragConfig).where(eq(ragConfig.id, config.id)).limit(1);
    const [currentJob] = await tx.select({
      revision: meetingRagIndexQueue.revision,
      status: meetingRagIndexQueue.status,
      requestedAt: meetingRagIndexQueue.requestedAt,
    }).from(meetingRagIndexQueue).where(eq(meetingRagIndexQueue.meetingDocumentId, document.id)).limit(1);
    const jobIsCurrent = currentJob?.revision === job.revision
      && currentJob.status === "processing"
      && currentJob.requestedAt.getTime() === job.requestedAt.getTime();
    if (!current || !jobIsCurrent) return;
    if (current.revision !== job.revision) {
      await queueMeetingIndex(tx, current.id, current.revision);
      return;
    }
    if (!currentConfig || !sameIndexConfig(currentConfig, config)) {
      await tx.update(meetingRagIndexQueue).set({
        status: "queued",
        requestedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
      }).where(and(
        eq(meetingRagIndexQueue.meetingDocumentId, document.id),
        eq(meetingRagIndexQueue.revision, job.revision),
        eq(meetingRagIndexQueue.status, "processing"),
        eq(meetingRagIndexQueue.requestedAt, job.requestedAt),
      ));
      return;
    }
    await tx.delete(meetingRagDocuments).where(eq(meetingRagDocuments.meetingDocumentId, document.id));
    if (chunks.length > 0) {
      await tx.insert(meetingRagDocuments).values(chunks.map((chunk, index) => ({
        meetingDocumentId: document.id,
        revision: document.revision,
        chunkIndex: chunk.chunkIndex,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        content: chunk.content,
        contentHash: chunk.contentHash,
        metadata: chunk.metadata,
        embedding: embeddings[index]!,
      })));
    }
    await tx.update(meetingRagIndexQueue).set({
      status: "ready",
      finishedAt: new Date(),
      errorMessage: null,
    }).where(and(
      eq(meetingRagIndexQueue.meetingDocumentId, document.id),
      eq(meetingRagIndexQueue.revision, job.revision),
      eq(meetingRagIndexQueue.status, "processing"),
      eq(meetingRagIndexQueue.requestedAt, job.requestedAt),
    ));
  });
}

export async function processMeetingRagIndexQueue(limit = 8): Promise<number> {
  await recoverStaleMeetingJobs();
  let attempted = 0;
  for (let index = 0; index < Math.max(0, Math.min(32, limit)); index += 1) {
    const job = await claimNextMeetingJob();
    if (!job) break;
    attempted += 1;
    try {
      const configured = await loadRagConfig();
      if (!configured.enabled) {
        await releaseClaimedMeetingJob(job);
        return attempted;
      }
      await indexMeetingJob(job, configured, {
        traceId: randomUUID(),
        metadata: { meetingDocumentId: job.meetingDocumentId, revision: job.revision },
      });
    } catch (error) {
      await getDb().update(meetingRagIndexQueue).set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: providerErrorMessage(error),
      }).where(and(
        eq(meetingRagIndexQueue.meetingDocumentId, job.meetingDocumentId),
        eq(meetingRagIndexQueue.revision, job.revision),
        eq(meetingRagIndexQueue.status, "processing"),
        eq(meetingRagIndexQueue.requestedAt, job.requestedAt),
      ));
    }
  }
  return attempted;
}
