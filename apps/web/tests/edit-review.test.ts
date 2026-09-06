import { expect, test } from "vitest";
import { buildDraftReviewFindings, parseEditReview } from "../src/lib/ai/edit-review.js";
import type { TermWritePayload } from "../src/lib/terms/form-payload.js";

const BASE_TERM: TermWritePayload = {
  qualityProfile: "auto",
  nameEn: "MTO",
  domain: [],
  category: [],
  topic: null,
  ownerId: null,
  surfaces: [],
};

test("AI 편집 검토는 허용된 분류와 RAG 출처만 통과시킨다", () => {
  const result = parseEditReview(JSON.stringify({
    summary: "정의와 기존 용어의 관계를 확인했습니다.",
    findings: [{
      kind: "contradiction",
      severity: "warning",
      title: "정의 범위가 다릅니다",
      description: "기존 정의는 주문 이후 생산만 포함합니다.",
      sourceSlugs: ["make-to-order", "invented-source"],
    }],
    suggestions: [
      { field: "definitionMd", value: "주문을 받은 뒤 생산을 시작하는 방식입니다.\n", reason: "기존 정의와 범위를 맞췄습니다.", sourceSlugs: ["make-to-order"] },
      { field: "domain", value: ["생산", "존재하지 않음"], reason: "분류를 정리했습니다." },
    ],
    relations: [
      { targetSlug: "make-to-order", relationType: "related_to", confidence: 87.6, reason: "같은 생산 방식입니다." },
      { targetSlug: "invented-source", relationType: "related_to", confidence: 99, reason: "모델이 만든 출처입니다." },
    ],
  }), ["생산"], ["operations"], [{ slug: "make-to-order", title: "주문 생산" }]);

  expect(result.findings[0]?.sources).toEqual([{ slug: "make-to-order", title: "주문 생산" }]);
  expect(result.suggestions).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "definitionMd", value: "주문을 받은 뒤 생산을 시작하는 방식입니다." }),
    expect.objectContaining({ field: "domain", value: ["생산"] }),
  ]));
  expect(result.relations).toEqual([expect.objectContaining({ targetSlug: "make-to-order", confidence: 88 })]);
});

test("AI 편집 검토는 설명과 코드 펜스가 섞인 JSON도 안전하게 추출한다", () => {
  const result = parseEditReview("결과입니다.```json\n{\"summary\":\"문제 없음\",\"findings\":[],\"suggestions\":[],\"relations\":[]}\n```", [], [], []);
  expect(result).toEqual({ summary: "문제 없음", findings: [], suggestions: [], relations: [], sources: [] });
});

test("AI 편집 검토는 JSON이 아니면 실패한다", () => {
  expect(() => parseEditReview("검토 결과가 없습니다.", [], [], [])).toThrow("INVALID_EDIT_REVIEW");
});

test("약어 원문이 없으면 AI가 문제없다고 해도 규칙 검토가 경고한다", () => {
  expect(buildDraftReviewFindings(BASE_TERM)).toEqual([
    expect.objectContaining({
      id: "rule-missing-english-expansion",
      kind: "missing",
      severity: "warning",
      title: "약어의 원문을 확인할 수 없습니다",
    }),
  ]);
  expect(buildDraftReviewFindings({ ...BASE_TERM, fullNameEn: "Make to Order" })).toEqual([]);
  expect(buildDraftReviewFindings({ ...BASE_TERM, fullNameEn: "Make to Stock" })).toEqual([
    expect.objectContaining({
      id: "rule-english-expansion-mismatch",
      kind: "consistency",
      title: "약어와 전체 이름 표기를 확인해 주세요",
    }),
  ]);
});
