import { expect, test } from "vitest";
import { buildRuleSuggestions, suggestionPatch } from "../src/lib/ai/contribution-suggestions.js";
import { parseAgentSuggestions } from "../src/lib/ai/contribution-agent.js";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  definitionMd: null,
  bodyMd: "배포 전에 변경 사항과 영향 범위를 함께 검토하는 팀 절차입니다. 이후 승인자가 배포 여부를 결정합니다.",
  domain: [],
  categories: [],
};

test("본문만 있는 용어에는 첫 설명 문장을 한줄 정의로 제안한다", () => {
  const suggestions = buildRuleSuggestions(base);
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0]).toMatchObject({ field: "definitionMd", source: "rule" });
  expect(suggestions[0]?.value).toBe("배포 전에 변경 사항과 영향 범위를 함께 검토하는 팀 절차입니다.");
});

test("이미 한줄 정의가 있거나 본문 근거가 짧으면 규칙 제안을 만들지 않는다", () => {
  expect(buildRuleSuggestions({ ...base, definitionMd: "기존 정의" })).toEqual([]);
  expect(buildRuleSuggestions({ ...base, bodyMd: "짧음" })).toEqual([]);
});

test("승인용 patch는 제안 필드 하나만 포함한다", () => {
  const suggestion = buildRuleSuggestions(base)[0]!;
  expect(suggestionPatch(suggestion)).toEqual({ definitionMd: suggestion.value });
});

test("AI 제안은 허용된 필드와 분류 값만 통과시킨다", () => {
  const suggestions = parseAgentSuggestions(JSON.stringify({ suggestions: [
    { field: "definitionMd", value: "배포 전에 변경 영향을 검토하는 팀 절차입니다.\n", reason: "본문에 근거함" },
    { field: "domain", value: ["개발", "존재하지 않음"], reason: "본문의 배포 맥락" },
    { field: "category", value: ["process", "unknown"], reason: "절차를 설명함" },
    { field: "status", value: "active", reason: "허용되지 않은 쓰기" },
  ] }), base, ["개발"], ["process"]);

  expect(suggestions.map((item) => [item.field, item.value])).toEqual([
    ["definitionMd", "배포 전에 변경 영향을 검토하는 팀 절차입니다."],
    ["domain", ["개발"]],
    ["category", ["process"]],
  ]);
});

test("AI가 JSON 계약을 지키지 않으면 제안으로 취급하지 않는다", () => {
  expect(() => parseAgentSuggestions("좋아 보입니다", base, [], [])).toThrow("INVALID_AGENT_RESPONSE");
});

test("사고 과정이나 설명 뒤에 붙은 JSON 객체도 안전하게 추출한다", () => {
  const answer = `<think>먼저 내용을 분석합니다.</think>\n검토 결과입니다.\n\`\`\`json\n{"suggestions":[{"field":"domain","value":"반도체","reason":"용어 맥락"}]}\n\`\`\``;
  expect(parseAgentSuggestions(answer, base, ["반도체"], [])).toMatchObject([
    { field: "domain", value: ["반도체"], source: "agent" },
  ]);
});

test("최상위 배열 응답도 제안 목록으로 해석한다", () => {
  const answer = JSON.stringify([{ field: "category", value: "process", reason: "공정 관련" }]);
  expect(parseAgentSuggestions(answer, base, [], ["process"])).toMatchObject([
    { field: "category", value: ["process"] },
  ]);
});

test("AI 관계 제안은 검색 근거에 포함된 다른 용어만 통과시킨다", () => {
  const target = { id: "00000000-0000-4000-8000-000000000002", slug: "manufacturing-to-order", name: "MTO" };
  const suggestions = parseAgentSuggestions(JSON.stringify({ suggestions: [
    { field: "relation", value: { targetTermId: target.id, relationType: "used_in", confidence: 84 }, reason: "생산 방식에 사용됨" },
    { field: "relation", value: { targetTermId: "00000000-0000-4000-8000-000000000003", relationType: "related_to" }, reason: "검색 근거 밖 대상" },
    { field: "relation", value: { targetTermId: target.id, relationType: "unknown" }, reason: "허용되지 않은 관계" },
  ] }), base, [], [], [target]);

  expect(suggestions).toEqual([{
    id: `agent-${base.id}-relation-${target.id}-used_in`,
    field: "relation",
    value: { targetTermId: target.id, targetSlug: target.slug, targetName: target.name, relationType: "used_in", confidence: 84 },
    reason: "생산 방식에 사용됨",
    source: "agent",
  }]);
});
