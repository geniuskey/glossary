import { expect, test } from "vitest";
import {
  detectIdentityIssues,
  identityCandidateFromTerm,
  parseIdentityReview,
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

test("표기 규칙은 약어 확장명 누락과 영문 필드의 한글을 찾는다", () => {
  const koreanInEnglish = detectIdentityIssues({ ...TERM, nameEn: "A자동", fullNameEn: null });
  const missingExpansion = detectIdentityIssues(TERM);

  expect(koreanInEnglish).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "nameEn", code: "english-contains-korean" }),
  ]));
  expect(missingExpansion).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameEn", code: "missing-expansion" }),
  ]));
});

test("약어 머리글자 비교는 영어 연결어를 제외한다", () => {
  const findings = detectIdentityIssues({
    ...TERM,
    nameEn: "OKR",
    fullNameEn: "Objectives and Key Results",
  });

  expect(findings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "fullNameEn", code: "expansion-mismatch" }),
  ]));
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
