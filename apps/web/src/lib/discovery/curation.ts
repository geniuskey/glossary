import { z } from "zod/v3";
import { RELATION_TYPES, type RelationType } from "@/lib/terms/relation-values";
import type { DiscoveryNode } from "./signals";

/**
 * 관계 정리 에이전트의 순수 규칙. 발굴의 상한은 그래프 밀도인데, 실데이터는 용어 1,545개에 승인 관계 13개였다.
 * 개념 용어마다 의미가 가까운 후보를 보여 주고 모델이 관계 종류를 고르게 해 proposed 관계를 쌓는다.
 * 승인은 사람이 한다.
 */

// 제품 모델명(IMX381, GC02M1B, SC550XS, Hi-1333, OV13B)은 개념이 아니다. 실데이터 이미지 센서 도메인의
// 대부분을 차지해, 거르지 않으면 "제품 A related_to 제품 B" 제안만 수백 개 쌓인다.
const PRODUCT_CODE = /^[A-Za-z]{1,6}[-\s]?\d[\w-]*(\s|$)/;

export function looksLikeProductCode(name: string): boolean {
  return PRODUCT_CODE.test(name.trim());
}

/** 정의가 있는 개념 용어를 도메인을 번갈아 고른다. 큰 도메인이 대상 전부를 차지하지 않게 한다. */
export function selectConceptTerms(nodes: readonly DiscoveryNode[], limit: number, minDefinitionChars = 40): DiscoveryNode[] {
  const lanes = new Map<string, DiscoveryNode[]>();
  for (const node of nodes) {
    if (node.definitionChars < minDefinitionChars || looksLikeProductCode(node.name)) continue;
    const lane = node.domains[0] ?? "";
    lanes.set(lane, [...(lanes.get(lane) ?? []), node]);
  }
  const ordered = [...lanes.values()].map((lane) => lane.sort((a, b) => b.definitionChars - a.definitionChars || a.id.localeCompare(b.id)));
  const picked: DiscoveryNode[] = [];
  for (let rank = 0; picked.length < limit && ordered.some((lane) => rank < lane.length); rank += 1) {
    for (const lane of ordered) if (rank < lane.length && picked.length < limit) picked.push(lane[rank]!);
  }
  return picked;
}

export interface CurationCandidate {
  ref: string;
  termId: string;
  name: string;
  domains: readonly string[];
  definition: string;
  similarity: number;
}

export interface RelationJudgment {
  candidate: CurationCandidate;
  relationType: RelationType;
  /** forward: 기준 용어 → 후보, reverse: 후보 → 기준 용어. is_a·part_of는 방향이 의미다. */
  direction: "forward" | "reverse";
  confidence: number;
  evidence: string;
}

const judgmentSchema = z.object({
  relations: z.array(z.object({
    candidate: z.string().trim(),
    type: z.string().trim(),
    direction: z.enum(["forward", "reverse"]).catch("forward"),
    confidence: z.coerce.number().catch(50),
    evidence: z.string().default("").transform((value) => value.trim().slice(0, 400)),
  }).passthrough()).default([]),
}).passthrough();

/**
 * 모델 판정을 검증한다. 없는 후보, 목록 밖 관계 종류, "none", 근거 문장이 없는 판정은 버린다.
 * 근거 없는 관계 제안은 검토자에게 판단 재료를 주지 않아 승인 피로만 만든다.
 * 신뢰도는 80으로 자른다 — 정의 두 개만 보고 내린 판정이 사람이 확인한 관계보다 높을 수 없다.
 */
export function parseRelationJudgments(raw: unknown, candidates: readonly CurationCandidate[], maxPerTerm = 3): RelationJudgment[] {
  const parsed = judgmentSchema.safeParse(raw);
  if (!parsed.success) return [];
  const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  const seen = new Set<string>();
  const judgments: RelationJudgment[] = [];
  for (const item of parsed.data.relations) {
    const candidate = byRef.get(item.candidate);
    if (!candidate || seen.has(candidate.ref) || !(RELATION_TYPES as readonly string[]).includes(item.type) || item.evidence.length < 10) continue;
    seen.add(candidate.ref);
    judgments.push({
      candidate,
      relationType: item.type as RelationType,
      // related_to는 대칭이라 방향을 고정한다. 같은 쌍이 두 방향으로 따로 제안되지 않게 한다.
      direction: item.type === "related_to" ? "forward" : item.direction,
      confidence: Math.max(1, Math.min(80, Math.round(item.confidence))),
      evidence: item.evidence,
    });
    if (judgments.length >= maxPerTerm) break;
  }
  return judgments;
}
