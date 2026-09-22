import "server-only";

import { asc } from "drizzle-orm";
import { ontologyPredicates } from "@glossary/db";
import { getDb } from "@/lib/db";

export type OntologyNodeKind = "term" | "wiki_page";

export interface OntologyPredicate {
  key: string;
  label: string;
  inverseKey: string | null;
  symmetric: boolean;
  transitive: boolean;
  sourceKind: OntologyNodeKind;
  targetKind: OntologyNodeKind;
  description: string | null;
}

/** 마이그레이션 직후에도 검색 규칙을 안전하게 적용할 수 있는 최소 기본값. */
export const FALLBACK_ONTOLOGY_PREDICATES: readonly OntologyPredicate[] = [
  { key: "related_to", label: "관련됨", inverseKey: "related_to", symmetric: true, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "is_a", label: "하위 종류임", inverseKey: "has_subtype", symmetric: false, transitive: true, sourceKind: "term", targetKind: "term", description: null },
  { key: "has_subtype", label: "하위 종류를 가짐", inverseKey: "is_a", symmetric: false, transitive: true, sourceKind: "term", targetKind: "term", description: null },
  { key: "part_of", label: "일부임", inverseKey: "contains", symmetric: false, transitive: true, sourceKind: "term", targetKind: "term", description: null },
  { key: "contains", label: "구성 요소를 가짐", inverseKey: "part_of", symmetric: false, transitive: true, sourceKind: "term", targetKind: "term", description: null },
  { key: "used_in", label: "사용됨", inverseKey: "has_usage", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "has_usage", label: "사용함", inverseKey: "used_in", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "prerequisite_of", label: "선행 조건임", inverseKey: "required_for", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "required_for", label: "선행 조건으로 요구됨", inverseKey: "prerequisite_of", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "replaces", label: "대체함", inverseKey: "replaced_by", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "replaced_by", label: "대체됨", inverseKey: "replaces", symmetric: false, transitive: false, sourceKind: "term", targetKind: "term", description: null },
  { key: "defines", label: "정의함", inverseKey: "defined_in", symmetric: false, transitive: false, sourceKind: "wiki_page", targetKind: "term", description: null },
  { key: "defined_in", label: "정의된 문서", inverseKey: "defines", symmetric: false, transitive: false, sourceKind: "term", targetKind: "wiki_page", description: null },
  { key: "applies_to", label: "적용됨", inverseKey: "applied_in", symmetric: false, transitive: false, sourceKind: "wiki_page", targetKind: "term", description: null },
  { key: "applied_in", label: "적용 문서", inverseKey: "applies_to", symmetric: false, transitive: false, sourceKind: "term", targetKind: "wiki_page", description: null },
];

export async function loadOntologyPredicates(database: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0] | ReturnType<typeof getDb> = getDb()): Promise<OntologyPredicate[]> {
  try {
    const rows = await database.select().from(ontologyPredicates).orderBy(asc(ontologyPredicates.sortOrder), asc(ontologyPredicates.key));
    if (rows.length > 0) return rows;
  } catch {
    // A rolling deploy can run the application before the new migration. The
    // built-in catalog keeps retrieval available until the migration completes.
  }
  return [...FALLBACK_ONTOLOGY_PREDICATES];
}

export function predicateMap(predicates: readonly OntologyPredicate[]): Map<string, OntologyPredicate> {
  return new Map(predicates.map((predicate) => [predicate.key, predicate]));
}
