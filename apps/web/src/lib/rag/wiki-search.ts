import "server-only";

import { and, arrayContains, asc, eq, sql } from "drizzle-orm";
import { wikiPages, wikiRagDocuments, wikiRagIndexQueue } from "@glossary/db";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiRunContext } from "@/lib/ai/observability-values";
import { getDb } from "@/lib/db";
import { loadRagConfig, runtimeEmbeddingConfig, runtimeRerankerConfig } from "./config";
import { embedTexts, rerankTexts } from "./provider";
import { RagNotReadyError } from "./search";

export interface WikiSearchOptions {
  topK?: number;
  domain?: string;
  rerank?: boolean;
  telemetry?: AiRunContext;
}

export interface WikiSearchHit {
  id: string;
  wikiPageId: string;
  slug: string;
  title: string;
  summary: string | null;
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

/** 공개된 현재 위키 revision만 vector 검색하고, 필요하면 reranker로 재정렬한다. */
export async function searchWikiRag(query: string, options: WikiSearchOptions = {}): Promise<WikiSearchHit[]> {
  const config = await loadRagConfig();
  if (!config.enabled) throw new RagNotReadyError("관리자가 RAG 검색을 활성화하지 않았습니다.");
  let embeddingConfig;
  try {
    embeddingConfig = runtimeEmbeddingConfig(config);
  } catch {
    throw new RagNotReadyError("Embedding API 비밀값을 읽을 수 없습니다. 관리자 설정을 확인해 주세요.");
  }
  const [queryEmbedding] = await embedTexts(embeddingConfig, [query], { ...options.telemetry, operation: "rag.embedding.wiki-query" });
  if (!queryEmbedding) throw new AiProviderError("Embedding 서버가 위키 검색 벡터를 반환하지 않았습니다.");

  const topK = Math.max(1, Math.min(50, Math.floor(options.topK ?? config.topK)));
  const useReranker = options.rerank ?? config.rerankerEnabled;
  const candidateLimit = Math.min(100, useReranker ? Math.max(topK * 4, 20) : topK);
  const distance = sql<number>`${wikiRagDocuments.embedding} <=> ${vectorParameter(queryEmbedding)}`;
  const rows = await getDb().select({
    id: wikiRagDocuments.id,
    wikiPageId: wikiPages.id,
    slug: wikiPages.slug,
    title: wikiPages.title,
    summary: wikiPages.summary,
    domain: wikiPages.domain,
    revision: wikiRagDocuments.revision,
    content: wikiRagDocuments.content,
    startOffset: wikiRagDocuments.startOffset,
    endOffset: wikiRagDocuments.endOffset,
    distance,
    updatedAt: wikiPages.updatedAt,
  }).from(wikiRagDocuments)
    .innerJoin(wikiPages, eq(wikiPages.id, wikiRagDocuments.wikiPageId))
    .innerJoin(wikiRagIndexQueue, and(
      eq(wikiRagIndexQueue.wikiPageId, wikiRagDocuments.wikiPageId),
      eq(wikiRagIndexQueue.revision, wikiRagDocuments.revision),
      eq(wikiRagIndexQueue.status, "ready"),
    ))
    .where(and(
      eq(wikiPages.status, "published"),
      options.domain ? arrayContains(wikiPages.domain, [options.domain]) : undefined,
      sql`${wikiRagDocuments.revision} = ${wikiPages.revision}`,
    ))
    .orderBy(asc(distance))
    .limit(candidateLimit);

  let ordered: Array<WikiSearchHit & { rank?: number }> = rows.map((row) => ({
    id: row.id,
    wikiPageId: row.wikiPageId,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
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
    const reranked = await rerankTexts(rerankerConfig, query, ordered.map((row) => row.content), { ...options.telemetry, operation: "rag.reranker.wiki-query" });
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
