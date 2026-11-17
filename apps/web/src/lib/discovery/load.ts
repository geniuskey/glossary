import "server-only";

import { eq, sql } from "drizzle-orm";
import { termRelations, terms, wikiPages, wikiPageTerms } from "@glossary/db";
import { getDb } from "@/lib/db";
import { usableRelationWhere } from "@/lib/terms/relations";
import { loadOntologyPredicates } from "@/lib/ontology/catalog";
import { displayName } from "@/lib/ui/format";
import type { DiscoveryGraph, DiscoveryNode } from "./signals";

// 그래프 전체를 메모리에 올린다. 신호(공통 이웃·사일로)는 부분 그래프로는 계산할 수 없다 —
// 이웃 일부만 보면 "관계가 없다"는 판단 자체가 거짓이 된다. 상한은 수만 개 규모 조직에서도
// 한 번의 요청이 수 MB 안에 머물도록 잡았다.
const MAX_TERMS = 20_000;
const MAX_RELATIONS = 60_000;
const SIMILARITY_SEEDS = 200;
const SIMILARITY_NEIGHBORS = 4;
const CROSS_DOMAIN_NEIGHBORS = 3;

export interface LoadedDiscoveryGraph extends DiscoveryGraph {
  transitiveTypes: string[];
  truncated: boolean;
}

/**
 * 임베딩 이웃을 붙인다. 구조 신호는 "이미 누군가 이어 둔 것"의 연장선만 보므로, 아무 관계도
 * 없는 고립된 용어끼리의 의미적 근접은 임베딩으로만 잡힌다. RAG가 꺼져 있거나 pgvector 색인이
 * 비어 있으면 빈 배열이고, 신호는 구조만으로 계속 동작한다.
 */
async function loadSimilarities(seedIds: string[]): Promise<DiscoveryGraph["similarities"]> {
  if (!seedIds.length) return [];
  const seeds = sql.join(seedIds.map((id) => sql`${id}::uuid`), sql`, `);
  try {
    // 가장 가까운 이웃은 거의 항상 같은 도메인의 변형이다(실데이터: 이웃 1,200쌍 중 도메인을 건넌 쌍 1개).
    // 새 도전은 도메인을 건너는 공명에서 나오므로, 도메인이 하나도 겹치지 않는 가장 가까운 이웃을 따로 찾는다.
    const rows = await getDb().execute<{ a: string; b: string; score: number }>(sql`
      select seed.term_id as a, near.term_id as b, (1 - (seed.embedding <=> near.embedding))::float8 as score
      from rag_documents seed
      cross join lateral (
        select other.term_id, other.embedding from rag_documents other
        where other.chunk_index = 0 and other.term_id <> seed.term_id
        order by other.embedding <=> seed.embedding
        limit ${SIMILARITY_NEIGHBORS}
      ) near
      where seed.chunk_index = 0 and seed.term_id in (${seeds})
      union all
      select seed.term_id as a, near.term_id as b, (1 - (seed.embedding <=> near.embedding))::float8 as score
      from rag_documents seed
      join terms seed_term on seed_term.id = seed.term_id
      cross join lateral (
        select other.term_id, other.embedding from rag_documents other
        join terms other_term on other_term.id = other.term_id
        where other.chunk_index = 0 and other.term_id <> seed.term_id
          and cardinality(other_term.domain) > 0 and not (other_term.domain && seed_term.domain)
        order by other.embedding <=> seed.embedding
        limit ${CROSS_DOMAIN_NEIGHBORS}
      ) near
      where seed.chunk_index = 0 and cardinality(seed_term.domain) > 0 and seed.term_id in (${seeds})
    `);
    return [...rows].map((row) => ({ a: String(row.a), b: String(row.b), score: Number(row.score) }));
  } catch {
    return [];
  }
}

/**
 * 임베딩 씨앗을 고른다. 주제 용어가 먼저이고, 나머지는 도메인을 번갈아 가며 관계가 적고 정의가 긴 용어를 고른다.
 * 정의가 긴 용어를 앞세우는 이유: 큰 도메인은 대부분 제품명(정의 짧음)이라 차수·id 순이면 씨앗이 제품명으로 찬다.
 */
export function pickSimilaritySeeds(nodes: readonly DiscoveryNode[], degree: ReadonlyMap<string, number>, preferred: readonly string[], limit: number): string[] {
  const ids = new Set(nodes.map((node) => node.id));
  const picked = [...new Set(preferred.filter((id) => ids.has(id)))].slice(0, limit);
  const chosen = new Set(picked);
  const lanes = new Map<string, DiscoveryNode[]>();
  for (const node of nodes) {
    if (chosen.has(node.id)) continue;
    const lane = node.domains[0] ?? "";
    lanes.set(lane, [...(lanes.get(lane) ?? []), node]);
  }
  const ordered = [...lanes.values()].map((lane) => lane.sort((a, b) => (degree.get(a.id) ?? 0) - (degree.get(b.id) ?? 0) || b.definitionChars - a.definitionChars || a.id.localeCompare(b.id)));
  for (let rank = 0; picked.length < limit && ordered.some((lane) => rank < lane.length); rank += 1) {
    for (const lane of ordered) {
      const node = lane[rank];
      if (node && picked.length < limit) picked.push(node.id);
    }
  }
  return picked;
}

export async function loadDiscoveryGraph(options: { domain?: string; withSimilarity?: boolean; seedTermIds?: readonly string[] } = {}): Promise<LoadedDiscoveryGraph> {
  const db = getDb();
  const [termRows, relationRows, pageRows, predicates] = await Promise.all([
    db.select({
      id: terms.id,
      slug: terms.slug,
      nameEn: terms.nameEn,
      nameKo: terms.nameKo,
      domain: terms.domain,
      category: terms.category,
      status: terms.status,
      definitionChars: sql<number>`coalesce(char_length(trim(${terms.definitionMd})), 0)::int`,
    }).from(terms)
      // 대체된(병합된) 용어는 살아 있는 개념이 아니다. 남겨 두면 옛 이름과 새 이름이 "관계 없는 유사 쌍"으로 뜬다.
      .where(sql`${terms.replacedById} is null`)
      .orderBy(terms.id)
      .limit(MAX_TERMS + 1),
    db.select({ id: termRelations.id, source: termRelations.sourceTermId, target: termRelations.targetTermId, type: termRelations.relationType, confidence: termRelations.confidence })
      .from(termRelations).where(usableRelationWhere()).orderBy(termRelations.id).limit(MAX_RELATIONS + 1),
    db.select({ id: wikiPages.id, slug: wikiPages.slug, title: wikiPages.title, termId: wikiPageTerms.termId })
      .from(wikiPageTerms)
      .innerJoin(wikiPages, eq(wikiPages.id, wikiPageTerms.wikiPageId))
      // 초안·보관 문서는 공식 근거가 아니다(RAG와 같은 규칙).
      .where(eq(wikiPages.status, "published")),
    loadOntologyPredicates(db),
  ]);

  const truncated = termRows.length > MAX_TERMS || relationRows.length > MAX_RELATIONS;
  let nodes: DiscoveryNode[] = termRows.slice(0, MAX_TERMS).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: displayName(row),
    domains: row.domain,
    categories: row.category,
    definitionChars: row.definitionChars,
    status: row.status,
  }));
  if (options.domain) nodes = nodes.filter((node) => node.domains.includes(options.domain!));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = relationRows.slice(0, MAX_RELATIONS)
    .filter((row) => ids.has(row.source) && ids.has(row.target))
    .map((row) => ({ ...row, type: String(row.type) }));

  const pagesById = new Map<string, { id: string; slug: string; title: string; termIds: string[] }>();
  for (const row of pageRows) {
    if (!ids.has(row.termId)) continue;
    const page = pagesById.get(row.id) ?? { id: row.id, slug: row.slug, title: row.title, termIds: [] };
    page.termIds.push(row.termId);
    pagesById.set(row.id, page);
  }

  let similarities: DiscoveryGraph["similarities"] = [];
  if (options.withSimilarity !== false) {
    // 이웃이 적은 용어부터 씨앗으로 쓴다. 관계가 많은 용어는 구조 신호가 이미 충분히 다룬다.
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const seeds = pickSimilaritySeeds(nodes, degree, options.seedTermIds ?? [], SIMILARITY_SEEDS);
    similarities = (await loadSimilarities(seeds))?.filter((pair) => ids.has(pair.a) && ids.has(pair.b));
  }

  return {
    nodes,
    edges,
    pages: [...pagesById.values()],
    similarities,
    transitiveTypes: predicates.filter((predicate) => predicate.transitive && predicate.sourceKind === "term").map((predicate) => predicate.key),
    truncated,
  };
}
