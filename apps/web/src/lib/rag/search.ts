import "server-only";

import { and, arrayContains, asc, eq, sql } from "drizzle-orm";
import { ragDocuments, ragIndexQueue, termRevisions, terms } from "@glossary/db";
import { getDb } from "@/lib/db";
import { AiProviderError } from "@/lib/ai/provider";
import { loadRagConfig, runtimeEmbeddingConfig, runtimeRerankerConfig } from "./config";
import { embedTexts, rerankTexts } from "./provider";

export class RagNotReadyError extends Error {
  constructor(message = "RAG 검색이 아직 설정되지 않았습니다.") {
    super(message);
  }
}

export interface RagSearchOptions {
  topK?: number;
  domain?: string;
  rerank?: boolean;
}

export interface RagSearchHit {
  id: string;
  termId: string;
  slug: string;
  title: string;
  nameEn: string | null;
  nameKo: string | null;
  domain: string[];
  categories: string[];
  topic: string | null;
  status: "draft" | "active";
  revision: number;
  sourceField: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  rerankScore: number | null;
  updatedAt: string;
}

function vectorParameter(vector: readonly number[]): ReturnType<typeof sql> {
  // `embedTexts` has already validated every value as a finite number. Passing
  // it as a bound parameter and casting it in SQL avoids raw SQL interpolation.
  return sql`${JSON.stringify(vector)}::vector`;
}

function titleOf(row: { nameKo: string | null; nameEn: string | null }): string {
  return row.nameKo || row.nameEn || "이름 없는 용어";
}

/** Vector search over current glossary revisions, optionally followed by reranking. */
export async function searchRag(query: string, options: RagSearchOptions = {}): Promise<RagSearchHit[]> {
  const config = await loadRagConfig();
  if (!config.enabled) throw new RagNotReadyError("관리자가 RAG 검색을 활성화하지 않았습니다.");

  let embeddingConfig;
  try {
    embeddingConfig = runtimeEmbeddingConfig(config);
  } catch {
    throw new RagNotReadyError("Embedding API 비밀값을 읽을 수 없습니다. 관리자 설정을 확인해 주세요.");
  }
  const [queryEmbedding] = await embedTexts(embeddingConfig, [query]);
  if (!queryEmbedding) throw new AiProviderError("Embedding 서버가 검색 벡터를 반환하지 않았습니다.");

  const topK = Math.max(1, Math.min(50, Math.floor(options.topK ?? config.topK)));
  const useReranker = options.rerank ?? config.rerankerEnabled;
  const candidateLimit = Math.min(100, useReranker ? Math.max(topK * 4, 20) : topK);
  const distance = sql<number>`${ragDocuments.embedding} <=> ${vectorParameter(queryEmbedding)}`;
  const rows = await getDb().select({
    id: ragDocuments.id,
    termId: ragDocuments.termId,
    slug: terms.slug,
    nameEn: terms.nameEn,
    nameKo: terms.nameKo,
    domain: terms.domain,
    categories: terms.category,
    topic: terms.topic,
    status: terms.status,
    revision: ragDocuments.revision,
    sourceField: ragDocuments.sourceField,
    content: ragDocuments.content,
    metadata: ragDocuments.metadata,
    distance,
    updatedAt: terms.updatedAt,
  }).from(ragDocuments)
    .innerJoin(terms, eq(terms.id, ragDocuments.termId))
    .innerJoin(ragIndexQueue, and(
      eq(ragIndexQueue.termId, ragDocuments.termId),
      eq(ragIndexQueue.revision, ragDocuments.revision),
      eq(ragIndexQueue.status, "ready"),
    ))
    .where(and(
      sql`${terms.replacedById} is null`,
      options.domain ? arrayContains(terms.domain, [options.domain]) : undefined,
      sql`${ragDocuments.revision} = (select coalesce(max(tr.revision_number), 0) from ${termRevisions} tr where tr.term_id = ${terms.id})`,
    ))
    .orderBy(asc(distance))
    .limit(candidateLimit);

  let ordered = rows.map((row) => ({
    ...row,
    title: titleOf(row),
    score: Math.max(-1, Math.min(1, 1 - Number(row.distance))),
    rerankScore: null as number | null,
    updatedAt: row.updatedAt.toISOString(),
  }));

  if (useReranker && ordered.length > 0) {
    let rerankerConfig;
    try {
      rerankerConfig = runtimeRerankerConfig(config);
    } catch {
      throw new RagNotReadyError("Reranker API 비밀값을 읽을 수 없습니다. 관리자 설정을 확인해 주세요.");
    }
    const reranked = await rerankTexts(rerankerConfig, query, ordered.map((row) => row.content));
    const byIndex = new Map(reranked.map((item) => [item.index, item.score]));
    ordered = ordered
      .map((row, index) => ({ ...row, rerankScore: byIndex.get(index) ?? null, rank: index }))
      .sort((a, b) => {
        if (a.rerankScore === null && b.rerankScore !== null) return 1;
        if (a.rerankScore !== null && b.rerankScore === null) return -1;
        return (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score) || a.rank - b.rank;
      })
      .map(({ rank: _rank, ...row }) => row);
  }
  return ordered.slice(0, topK).map(({ distance: _distance, ...row }) => row);
}
