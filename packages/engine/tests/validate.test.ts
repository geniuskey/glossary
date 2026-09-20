import { describe, expect, test } from "vitest";
import { compileLexicon, validateDocument, type LexiconEntry } from "../src/index.js";

const lexicon: LexiconEntry[] = [
  { termId: "ae", slug: "auto-exposure", text: "Auto Exposure", kind: "canonical" },
  { termId: "ae", slug: "auto-exposure", text: "AE", kind: "abbreviation" },
  { termId: "ae", slug: "auto-exposure", text: "자동노출", kind: "discouraged" },
  { termId: "sensor", slug: "image-sensor", text: "이미지 센서", kind: "canonical" },
  { termId: "gain", slug: "gain-control", text: "Gain Control", kind: "canonical" },
  { termId: "gain", slug: "gain-control", text: "GainCtrl", kind: "forbidden", replacement: { text: "Gain Control", slug: "gain-control" } },
  { termId: "ambiguous-a", slug: "a", text: "ISP", kind: "canonical" },
  { termId: "ambiguous-b", slug: "b", text: "ISP", kind: "canonical" },
];

describe("validateDocument", () => {
  test("표기 위치를 보존하면서 비권장·금지 표기를 찾는다", () => {
    const result = validateDocument("AE와 자동노출을 거쳐 GainCtrl을 조정합니다.", lexicon, { extractUnregistered: false });
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "non_standard", text: "자동노출", start: 4, end: 8, replacement: { text: "Auto Exposure", slug: "auto-exposure" } }),
      expect.objectContaining({ rule: "forbidden", text: "GainCtrl", replacement: { text: "Gain Control", slug: "gain-control" } }),
    ]);
    expect(result.stats).toMatchObject({ matched: 3, errors: 1, warnings: 1 });
  });

  test("공백·하이픈·CamelCase 변형을 하나의 표기로 매칭한다", () => {
    const result = validateDocument("Auto-Exposure, AutoExposure, auto exposure", lexicon, { extractUnregistered: false });
    expect(result.stats.matched).toBe(3);
    expect(result.findings).toHaveLength(0);
  });

  test("동음이의어는 후보를 함께 돌려준다", () => {
    const result = validateDocument("ISP 설정", lexicon, { extractUnregistered: false });
    expect(result.findings[0]).toMatchObject({ rule: "ambiguous", text: "ISP", start: 0, end: 3 });
    expect(result.findings[0]?.candidates).toHaveLength(2);
  });

  test("한국어 조사는 허용하지만 더 긴 단어 안쪽 매칭은 거부한다", () => {
    const result = validateDocument("이미지 센서의 이미지센서티브 값을 확인합니다.", lexicon, { extractUnregistered: false });
    expect(result.stats.matched).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  test("Markdown 코드·URL·front matter는 검사하지 않는다", () => {
    const document = [
      "---",
      "title: AE",
      "---",
      "본문의 AE는 검사합니다.",
      "`GainCtrl`은 코드입니다.",
      "```ts",
      "const value = GainCtrl;",
      "```",
      "https://example.com/AE",
    ].join("\n");
    const result = validateDocument(document, lexicon, { extractUnregistered: false });
    expect(result.stats.matched).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  test("등록되지 않은 약어 후보를 추출하고 무시 목록을 적용한다", () => {
    const result = validateDocument("MIPI와 AWB, TODO를 확인합니다.", lexicon, { ignoredCandidates: ["TODO"] });
    expect(result.findings.filter((finding) => finding.rule === "unregistered").map((finding) => finding.text)).toEqual(["MIPI", "AWB"]);
  });

  test("컴파일된 사전을 재사용하고 사전 버전을 응답에 포함한다", () => {
    const compiled = compileLexicon(lexicon, "sha256:test");
    const result = validateDocument("AE", compiled, { extractUnregistered: false });
    expect(result.lexiconVersion).toBe("sha256:test");
  });
});
