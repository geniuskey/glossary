import "server-only";

import type { termRelations } from "@glossary/db";
import { getDb } from "@/lib/db";
import { approvedRelations } from "@/lib/terms/relations";
import { predicateMap, type OntologyPredicate } from "./catalog";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type RelationRow = typeof termRelations.$inferSelect;

export interface OntologyTermPath {
  id: string;
  sourceTermId: string;
  targetTermId: string;
  predicateKey: string;
  /** 검색 씨앗에서 이 edge까지 도달한 BFS depth (1 = 직접, 2 = 두 번째 확장). */
  depth: number;
  confidence: number;
  evidenceMd: string | null;
  sourceRevision: number | null;
  targetRevision: number | null;
  relationId: string;
}

export interface OntologyExpansion {
  paths: OntologyTermPath[];
  relations: RelationRow[];
}

/**
 * 승인된 관계만 사용해 제한된 깊이로 개념 그래프를 확장한다.
 *
 * 추이성 자체를 무제한으로 계산하지 않고, 질문당 최대 2-hop으로 제한한다.
 * 그래프가 커져도 챗봇 근거가 폭발하지 않고, 모든 경로가 원래 관계의
 * 리비전·근거를 그대로 추적할 수 있게 하는 것이 목적이다.
 */
export async function expandApprovedOntology(
  database: Db | Tx,
  seedTermIds: readonly string[],
  predicates: readonly OntologyPredicate[],
  options: { maxDepth?: number; limit?: number; domain?: string } = {},
): Promise<OntologyExpansion> {
  const seeds = [...new Set(seedTermIds)];
  if (seeds.length === 0) return { paths: [], relations: [] };
  const maxDepth = Math.max(1, Math.min(2, options.maxDepth ?? 2));
  const limit = Math.max(1, Math.min(120, options.limit ?? 80));
  const catalog = predicateMap(predicates);
  const visited = new Set(seeds);
  let frontier = new Set(seeds);
  const paths: OntologyTermPath[] = [];
  const relations = new Map<string, RelationRow>();

  for (let depth = 1; depth <= maxDepth && frontier.size > 0 && paths.length < limit; depth += 1) {
    const rows = await approvedRelations(database, [...frontier], Math.min(100, limit * 2), options.domain);
    const next = new Set<string>();
    for (const row of rows) {
      const sourceIsFrontier = frontier.has(row.sourceTermId);
      const targetIsFrontier = frontier.has(row.targetTermId);
      if (!sourceIsFrontier && !targetIsFrontier) continue;

      // A relation can touch both frontier sides. Prefer the source-oriented
      // direction so a single edge is not counted twice in one BFS layer.
      const sourceTermId = sourceIsFrontier ? row.sourceTermId : row.targetTermId;
      const targetTermId = sourceIsFrontier ? row.targetTermId : row.sourceTermId;
      // Keep direct links between the original seeds, but do not spend the
      // second hop walking back into an already visited node.
      if (depth > 1 && visited.has(targetTermId)) continue;
      const basePredicate = catalog.get(row.relationType);
      const predicateKey = sourceIsFrontier
        ? row.relationType
        : basePredicate?.inverseKey ?? row.relationType;
      const pathKey = `${sourceTermId}:${predicateKey}:${targetTermId}`;
      if (paths.some((path) => path.id === pathKey)) continue;
      paths.push({
        id: pathKey,
        sourceTermId,
        targetTermId,
        predicateKey,
        depth,
        confidence: row.confidence,
        evidenceMd: row.evidenceMd,
        sourceRevision: sourceIsFrontier ? row.sourceRevision : row.targetRevision,
        targetRevision: sourceIsFrontier ? row.targetRevision : row.sourceRevision,
        relationId: row.id,
      });
      relations.set(row.id, row);
      if (!visited.has(targetTermId)) {
        visited.add(targetTermId);
        next.add(targetTermId);
      }
      if (paths.length >= limit) break;
    }
    frontier = next;
  }

  return { paths, relations: [...relations.values()] };
}

export function ontologyPathScore(path: Pick<OntologyTermPath, "depth" | "confidence">): number {
  return (0.5 * Math.max(0, Math.min(100, path.confidence)) / 100) / (60 + path.depth * 30);
}
