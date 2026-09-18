import { expect, test } from "vitest";
import {
  detectIdentityIssues,
  identityCandidateFromTerm,
  parseIdentityReview,
  shouldOfferIdentityEnrichment,
  shouldKeepIdentityReviewCandidate,
} from "../src/lib/ai/identity-review.js";

const TERM = {
  id: "00000000-0000-4000-8000-000000000001",
  nameEn: "AE",
  nameKo: "자동 노출",
  fullNameEn: null,
  fullNameKo: null,
  surfaces: [
    { id: "00000000-0000-4000-8000-000000000010", text: "자동노출", lang: "ko" as const, kind: "alias" as const },
  ],
};

test("표기 규칙은 영문 필드의 한글을 찾고 약어 확장명 누락은 오류로 보지 않는다", () => {
  const koreanInEnglish = detectIdentityIssues({ ...TERM, nameEn: "A자동", fullNameEn: null });
  const noExpansion = detectIdentityIssues(TERM);

  expect(koreanInEnglish).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "nameEn", code: "english-contains-korean" }),
  ]));
  expect(noExpansion).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameEn", code: "missing-expansion" }),
  ]));
});

test("약어와 영문 확장명의 글자 대응은 규칙상 오류로 판정하지 않는다", () => {
  const okrFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "OKR",
    fullNameEn: "Objectives and Key Results",
  });
  const rfpFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "RFP",
    fullNameEn: "Request for Proposal",
  });
  const roiFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "ROI",
    fullNameEn: "Return on Investment",
  });
  const restFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "REST",
    fullNameEn: "Representational State Transfer",
  });
  const euvFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "EUV",
    fullNameEn: "Extreme Ultraviolet",
  });
  const missingExpansionFindings = detectIdentityIssues({
    ...TERM,
    nameEn: "EUV",
    fullNameEn: null,
  });

  for (const findings of [okrFindings, rfpFindings, roiFindings, restFindings, euvFindings, missingExpansionFindings]) {
    expect(findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fullNameEn", code: "expansion-mismatch" }),
    ]));
    expect(findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fullNameEn", code: "missing-expansion" }),
    ]));
  }
});

test("대표 표기와 도메인이 있으면 확장명 누락이 아니라 AI 보완 후보가 된다", () => {
  expect(shouldOfferIdentityEnrichment({
    ...TERM,
    nameEn: "EUV",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
    domain: ["반도체"],
    surfaces: [],
  })).toBe(true);
  expect(shouldOfferIdentityEnrichment({
    ...TERM,
    nameEn: "EUV",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
    domain: [],
    surfaces: [],
  })).toBe(false);
});

test("AI가 확정 가능한 제안을 찾지 못하면 표기 정비 후보에서 제외한다", () => {
  const issue = [{ id: "surface:language", field: "surface" as const, code: "language", severity: "warning" as const, message: "언어 분류를 확인하세요." }];
  expect(shouldKeepIdentityReviewCandidate(issue, false, null)).toBe(true);
  expect(shouldKeepIdentityReviewCandidate(issue, false, { suggestions: [] })).toBe(false);
  expect(shouldKeepIdentityReviewCandidate([], true, { suggestions: [] })).toBe(false);
  expect(shouldKeepIdentityReviewCandidate(issue, false, { suggestions: [{} as never] })).toBe(true);
});

test("영어 약어의 국문 확장명 부재는 확인 필요나 AI finding으로 남기지 않는다", () => {
  const result = parseIdentityReview(JSON.stringify({
    findings: [
      { field: "fullNameKo", code: "missing", severity: "warning", message: "국문 확장명이 비어 있어 확인이 필요합니다." },
      { field: "fullNameEn", code: "source", severity: "info", message: "영문 확장명의 근거를 확인하세요." },
    ],
    uncertainties: [
      "OKR의 국문 확장명이 없어 확인이 필요합니다.",
      "본문에 공식 약어 사용 맥락이 충분하지 않습니다.",
    ],
  }), {
    ...TERM,
    nameEn: "OKR",
    fullNameEn: "Objectives and Key Results",
    fullNameKo: null,
  });

  expect(result.findings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameKo" }),
  ]));
  expect(result.uncertainties).not.toContain("OKR의 국문 확장명이 없어 확인이 필요합니다.");
  expect(result.uncertainties).toContain("본문에 공식 약어 사용 맥락이 충분하지 않습니다.");
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameEn", code: "source" }),
  ]));
});

test("국문 대표명과 국문 확장명은 실제 국문 약어일 때만 제안한다", () => {
  const mto = parseIdentityReview(JSON.stringify({
    suggestions: [{
      field: "nameKo",
      action: "fill",
      value: "MTO",
      reason: "한국에서도 MTO로 사용됩니다.",
    }],
  }), {
    ...TERM,
    nameEn: "MTO",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
  });
  expect(mto.suggestions).toEqual([]);

  const rag = parseIdentityReview(JSON.stringify({
    suggestions: [
      {
        field: "fullNameKo",
        action: "fill",
        value: "검색 증강 생성",
        reason: "이미 등록된 국문 대표명입니다.",
      },
      {
        field: "fullNameKo",
        action: "fill",
        value: "검색증강생성",
        reason: "국문 표기의 변형입니다.",
      },
    ],
  }), {
    ...TERM,
    nameEn: "RAG",
    nameKo: "검색 증강 생성",
    fullNameEn: "Retrieval-Augmented Generation",
    fullNameKo: null,
  });
  expect(rag.suggestions).toEqual([]);

  const koreanAbbreviation = parseIdentityReview(JSON.stringify({
    suggestions: [{
      field: "fullNameKo",
      action: "fill",
      value: "생성형 인공지능",
      reason: "명시된 국문 약어의 전체 표현입니다.",
    }],
  }), {
    ...TERM,
    nameEn: "GenAI",
    nameKo: "생성형 AI",
    fullNameEn: "Generative AI",
    fullNameKo: null,
    surfaces: [
      { id: "00000000-0000-4000-8000-000000000011", text: "생성형 AI", lang: "neutral" as const, kind: "abbreviation" as const },
    ],
  });
  expect(koreanAbbreviation.suggestions).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameKo", value: "생성형 인공지능" }),
  ]));
});

test("같은 표기는 대표 필드와 추가 표기에 중복 제안하지 않는다", () => {
  const result = parseIdentityReview(JSON.stringify({
    suggestions: [
      {
        field: "surface",
        action: "add",
        value: { text: "Cryogenics", kind: "alias" },
        reason: "영문 별칭입니다.",
      },
      {
        field: "nameEn",
        action: "fill",
        value: "Cryogenics",
        reason: "대표 영문 표기입니다.",
      },
    ],
  }), {
    ...TERM,
    nameEn: null,
    nameKo: "극저온",
    fullNameEn: null,
    fullNameKo: null,
    surfaces: [],
  });

  expect(result.suggestions).toEqual([
    expect.objectContaining({ field: "nameEn", value: "Cryogenics" }),
  ]);
});

test("AI 표기 제안은 허용된 필드·표기 종류·근거만 통과시킨다", () => {
  const result = parseIdentityReview(JSON.stringify({
    findings: [
      { field: "fullNameEn", code: "missing", severity: "warning", message: "확장명을 확인하세요." },
      { field: "unknown", code: "ignore", message: "통과하면 안 됩니다." },
    ],
    suggestions: [
      {
        field: "fullNameEn",
        action: "fill",
        value: "Auto Exposure",
        reason: "AE의 본문 근거와 일치합니다.",
        confidence: 92,
        sourceSlugs: ["auto-exposure", "not-a-source"],
      },
      {
        field: "surface",
        action: "reclassify",
        value: { id: TERM.surfaces[0]!.id, text: "자동노출", kind: "discouraged" },
        reason: "사용 지침상 비권장 표기입니다.",
        confidence: 0.8,
        sourceSlugs: ["auto-exposure"],
      },
      {
        field: "surface",
        action: "add",
        value: { text: "A/E", kind: "abbreviation" },
        reason: "본문에 실제로 사용된 약어입니다.",
        confidence: 0.7,
        sourceSlugs: ["auto-exposure"],
      },
      {
        field: "surface",
        action: "add",
        value: { text: "자동노출", kind: "alias" },
        reason: "이미 있는 표기라 통과하면 안 됩니다.",
      },
    ],
    uncertainties: ["공식 영문 확장명은 원문 확인이 필요합니다."],
  }), TERM, [{ slug: "auto-exposure", title: "자동 노출" }]);

  expect(result.suggestions).toHaveLength(3);
  expect(result.suggestions).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameEn", value: "Auto Exposure", confidence: 0.92, sources: [{ slug: "auto-exposure", title: "자동 노출" }] }),
    expect.objectContaining({ field: "surface", action: "reclassify", value: expect.objectContaining({ lang: "ko", kind: "discouraged" }) }),
    expect.objectContaining({ field: "surface", action: "add", value: expect.objectContaining({ text: "A/E", lang: "en", kind: "abbreviation" }) }),
  ]));
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: "확장명을 확인하세요." }),
  ]));
  expect(result.uncertainties).toEqual(["공식 영문 확장명은 원문 확인이 필요합니다."]);
});

test("표기 후보는 다른 용어와 겹치는 추가 표기를 문제로 표시한다", () => {
  const candidate = identityCandidateFromTerm({
    ...TERM,
    slug: "auto-exposure",
    revision: 3,
  }, new Set(["자동노출"]));

  expect(candidate.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "cross-term-자동노출", field: "surface" }),
  ]));
});

test("대표명에서 파생된 표기는 surface 액션의 직접 대상이 아니다", () => {
  const result = parseIdentityReview(JSON.stringify({
    suggestions: [{
      field: "surface",
      action: "reclassify",
      value: { id: "derived", text: "AE", kind: "alias" },
      reason: "대표 표기의 종류를 바꿉니다.",
    }],
  }), {
    ...TERM,
    surfaces: [
      { id: "derived", text: "AE", lang: "en" as const, kind: "canonical" as const },
      ...TERM.surfaces,
    ],
  });

  expect(result.suggestions).toEqual([]);
});
