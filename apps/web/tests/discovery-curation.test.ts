import { expect, test } from "vitest";
import { looksLikeProductCode, parseRelationJudgments, selectConceptTerms, type CurationCandidate } from "../src/lib/discovery/curation.js";
import type { DiscoveryNode } from "../src/lib/discovery/signals.js";

test("제품 모델명은 개념 용어에서 거른다", () => {
  for (const name of ["IMX381", "GC02M1B", "SC550XS", "Hi-1333", "OV13B", "LYTIA 505"]) expect(looksLikeProductCode(name), name).toBe(true);
  for (const name of ["Image Sensor", "CMP", "Etch Bias", "2.5D IC", "CIS", "번인"]) expect(looksLikeProductCode(name), name).toBe(false);
});

test("정의가 있는 개념 용어를 도메인을 번갈아 고른다", () => {
  const n = (id: string, domain: string, definitionChars: number): DiscoveryNode => ({ id, slug: id, name: id, domains: [domain], categories: [], definitionChars, status: "active" });
  const picked = selectConceptTerms([n("IMX381", "센서", 300), n("Pixel", "센서", 200), n("CIS", "센서", 250), n("Etch", "공정", 100), n("Thin", "공정", 10)], 3);
  expect(picked.map((node) => node.id)).toEqual(["CIS", "Etch", "Pixel"]);
});

test("관계 판정은 목록 안의 후보·관계 종류·근거 문장이 있을 때만 받고 신뢰도는 80으로 자른다", () => {
  const candidate = (ref: string): CurationCandidate => ({ ref, termId: ref.toLowerCase(), name: ref, domains: [], definition: "d", similarity: 0.7 });
  const judgments = parseRelationJudgments({ relations: [
    { candidate: "C1", type: "part_of", direction: "reverse", confidence: 99, evidence: "C1 정의에 BASE의 구성 요소라고 적혀 있다" },
    { candidate: "C2", type: "none", direction: "forward", confidence: 90, evidence: "관계 없음이라고 판단한 이유" },
    { candidate: "C3", type: "related_to", direction: "reverse", confidence: 40, evidence: "업무상 함께 검토되는 단계라고 정의에 있다" },
    { candidate: "C4", type: "is_a", confidence: 70, evidence: "짧음" },
    { candidate: "C9", type: "is_a", confidence: 70, evidence: "존재하지 않는 후보에 대한 판정 문장" },
    { candidate: "C1", type: "is_a", confidence: 70, evidence: "같은 후보를 두 번 판정한 문장입니다" },
  ] }, ["C1", "C2", "C3", "C4"].map(candidate));
  expect(judgments.map((judgment) => [judgment.candidate.ref, judgment.relationType, judgment.direction, judgment.confidence])).toEqual([
    ["C1", "part_of", "reverse", 80],
    ["C3", "related_to", "forward", 40],
  ]);
  expect(parseRelationJudgments("x", [])).toEqual([]);
});
