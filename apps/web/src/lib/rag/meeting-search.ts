import "server-only";

import { and, arrayContains, asc, eq, gte, lte, sql } from "drizzle-orm";
import { meetingDocuments, meetingRagDocuments, meetingRagIndexQueue } from "@glossary/db";
import { getDb } from "@/lib/db";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiRunContext } from "@/lib/ai/observability-values";
import { loadRagConfig, runtimeEmbeddingConfig, runtimeRerankerConfig } from "./config";
import { embedTexts, rerankTexts } from "./provider";
import { RagNotReadyError } from "./search";

export interface MeetingSearchOptions {
  topK?: number;
  domain?: string;
  team?: string;
  from?: Date;
  to?: Date;
  rerank?: boolean;
  telemetry?: AiRunContext;
}

export interface MeetingSearchHit {
  id: string;
  meetingDocumentId: string;
  title: string;
  meetingDate: string | null;
  source: string;
  team: string;
  domain: string[];
  revision: number;
  content: string;
  startOffset: number;
  endOffset: number;
  score: number;
  rerankScore: number | null;
  updatedAt: string;
}

function vectorParameter(vector: readonly number[]): ReturnType<typeof sql> {
  return sql`${JSON.stringify(vector)}::vector`;
}

/** 과거 회의록의 현재 revision만 vector 검색하고, 필요하면 reranker로 재정렬한다. */
export async function searchMeetingRag(query: string, options: MeetingSearchOptions = {}): Promise<MeetingSearchHit[]> {
  const config = await loadRagConfig();
  if (!config.enabled) throw new RagNotReadyError("관리자가 RAG 검색을 활성화하지 않았습니다.");
  let embeddingConfig;
  try {
    embeddingConfig = runtimeEmbeddingConfig(config);
  } catch {
    throw new RagNotReadyError("Embedding API 비밀값을 읽을 수 없습니다. 관리자 설정을 확인해 주세요.");
  }
  const [queryEmbedding] = await embedTexts(embeddingConfig, [query], { ...options.telemetry, operation: "rag.embedding.meeting-query" });
  if (!queryEmbedding) throw new AiProviderError("Embedding 서버가 회의록 검색 벡터를 반환하지 않았습니다.");

  const topK = Math.max(1, Math.min(50, Math.floor(options.topK ?? config.topK)));
  const useReranker = options.rerank ?? config.rerankerEnabled;
  const candidateLimit = Math.min(100, useReranker ? Math.max(topK * 4, 20) : topK);
  const distance = sql<number>`${meetingRagDocuments.embedding} <=> ${vectorParameter(queryEmbedding)}`;
  const rows = await getDb().select({
    id: meetingRagDocuments.id,
    meetingDocumentId: meetingDocuments.id,
    title: meetingDocuments.title,
    meetingDate: meetingDocuments.meetingDate,
    source: meetingDocuments.source,
    team: meetingDocuments.team,
    domain: meetingDocuments.domain,
    revision: meetingRagDocuments.revision,
    content: meetingRagDocuments.content,
    startOffset: meetingRagDocuments.startOffset,
    endOffset: meetingRagDocuments.endOffset,
    distance,
    updatedAt: meetingDocuments.updatedAt,
  }).from(meetingRagDocuments)
    .innerJoin(meetingDocuments, eq(meetingDocuments.id, meetingRagDocuments.meetingDocumentId))
    .innerJoin(meetingRagIndexQueue, and(
      eq(meetingRagIndexQueue.meetingDocumentId, meetingRagDocuments.meetingDocumentId),
      eq(meetingRagIndexQueue.revision, meetingRagDocuments.revision),
      eq(meetingRagIndexQueue.status, "ready"),
    ))
    .where(and(
      eq(meetingDocuments.status, "active"),
      options.domain ? arrayContains(meetingDocuments.domain, [options.domain]) : undefined,
      options.team ? eq(meetingDocuments.team, options.team) : undefined,
      options.from ? gte(meetingDocuments.meetingDate, options.from) : undefined,
      options.to ? lte(meetingDocuments.meetingDate, options.to) : undefined,
      sql`${meetingRagDocuments.revision} = ${meetingDocuments.revision}`,
    ))
    .orderBy(asc(distance))
    .limit(candidateLimit);

  let ordered: Array<MeetingSearchHit & { rank?: number }> = rows.map((row) => ({
    id: row.id,
    meetingDocumentId: row.meetingDocumentId,
    title: row.title,
    meetingDate: row.meetingDate?.toISOString() ?? null,
    source: row.source,
    team: row.team,
    domain: row.domain,
    revision: row.revision,
    content: row.content,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    score: Math.max(-1, Math.min(1, 1 - Number(row.distance))),
    rerankScore: null,
    updatedAt: row.updatedAt.toISOString(),
  }));
  if (useReranker && ordered.length > 0) {
    let rerankerConfig;
    try {
      rerankerConfig = runtimeRerankerConfig(config);
    } catch {
      throw new RagNotReadyError("Reranker API 비밀값을 읽을 수 없습니다. 관리자 설정을 확인해 주세요.");
    }
    const reranked = await rerankTexts(rerankerConfig, query, ordered.map((row) => row.content), { ...options.telemetry, operation: "rag.reranker.meeting-query" });
    const byIndex = new Map(reranked.map((item) => [item.index, item.score]));
    ordered = ordered
      .map((row, index) => ({ ...row, rerankScore: byIndex.get(index) ?? null, rank: index }))
      .sort((a, b) => {
        if (a.rerankScore === null && b.rerankScore !== null) return 1;
        if (a.rerankScore !== null && b.rerankScore === null) return -1;
        return (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score) || a.rank! - b.rank!;
      });
  }
  return ordered.slice(0, topK).map(({ rank: _rank, ...row }) => row);
}
