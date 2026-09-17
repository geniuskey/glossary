import { afterEach, expect, test, vi } from "vitest";
import type { ChatEvidence } from "../src/lib/ai/grounding-values.js";
import { relevantPassages } from "../src/lib/ai/passages.js";

const complete = vi.hoisted(() => vi.fn());
const retrieve = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/ai/provider", () => ({ completeAi: complete }));
vi.mock("../src/lib/ai/retrieval", () => ({ retrieveGlossaryContext: retrieve }));
const { answerWithEvidence, validateGroundedAnswer } = await import("../src/lib/ai/grounded-answer.js");
const config = { provider: "openai_compatible" as const, baseUrl: "http://127.0.0.1", model: "test", apiKey: "", customHeaders: [] };
const evidence: ChatEvidence = { id: "term:1:body:0", slug: "settlement", title: "정산", revision: 1, updatedAt: "2026-09-10T01:00:00.000Z", field: "body", excerpt: "정산은 다음 영업일에 실행한다.", start: 0 };
const source = { slug: "settlement", title: "정산", definition: "정산", status: "active" as const, revision: 1 };
const grounding = { sources: [source], evidence: [evidence], context: "{}" };
afterEach(() => { complete.mockReset(); retrieve.mockReset(); });

test("3,000자 뒤의 관련 구절을 원문의 정확한 위치와 함께 선택한다", () => {
  const body = `${"일반 설명입니다.\n\n".repeat(500)}예외 정책: 해외 정산은 영업일 기준 3일 뒤 실행한다.\n\n추가 안내`;
  const passages = relevantPassages(body, ["해외", "정산", "예외"], 3);
  expect(passages.some((passage) => passage.start > 3000 && passage.text.includes("해외 정산"))).toBe(true);
  for (const passage of passages) expect(body.slice(passage.start, passage.start + passage.text.length)).toBe(passage.text);
  expect(passages.every((passage) => passage.text.length <= 900)).toBe(true);
});

test("주장에 없는 인용이나 위조된 인용 ID가 있으면 응답을 거부한다", () => {
  expect(validateGroundedAnswer({ claims: [{ text: "정산 설명", evidenceIds: ["invented"] }], uncertainties: [], followUpQuery: null }, [evidence])).toBeNull();
  expect(validateGroundedAnswer({ claims: [{ text: "정산 설명", evidenceIds: [] }], uncertainties: [], followUpQuery: null }, [evidence])).toBeNull();
  expect(validateGroundedAnswer({ claims: [{ text: "정산 설명", evidenceIds: [evidence.id] }], uncertainties: [], followUpQuery: null }, [evidence])).not.toBeNull();
});

test("실제 인용한 근거만 응답에 남기고 기준 리비전과 원문을 보존한다", async () => {
  const unused = { ...evidence, id: "unused", slug: "unused" };
  complete.mockResolvedValueOnce(JSON.stringify({ claims: [{ text: "정산은 다음 영업일에 실행합니다.", evidenceIds: [evidence.id] }], uncertainties: ["공휴일 처리는 확인이 필요합니다."], followUpQuery: null }));
  const result = await answerWithEvidence(config, "정산 시점?", [], { ...grounding, evidence: [evidence, unused], sources: [source, { ...source, slug: "unused" }] }, ["정산"]);
  expect(result.answer).toContain("[1]");
  expect(result.grounded.evidence).toEqual([evidence]);
  expect(result.sources).toEqual([source]);
  expect(result.grounded.uncertainties).toHaveLength(1);
});

test("추가 검색도 선택한 도메인 안에서 한 번만 수행한다", async () => {
  complete.mockResolvedValueOnce(JSON.stringify({ claims: [], uncertainties: [], followUpQuery: "공휴일 정산" }))
    .mockResolvedValueOnce(JSON.stringify({ claims: [{ text: "정산 시점입니다.", evidenceIds: [evidence.id] }], uncertainties: [], followUpQuery: "더 검색해줘" }));
  retrieve.mockResolvedValueOnce(grounding);
  const result = await answerWithEvidence(config, "공휴일 정산은?", [], grounding, ["정산"], { domain: "결제" });
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(retrieve.mock.calls[0]?.[2]).toMatchObject({ domain: "결제" });
  expect(result.grounded.searchedQueries).toEqual(["정산", "공휴일 정산"]);
  expect(result.grounded.domain).toBe("결제");
});

test("추가 검색에서 리비전이 바뀌면 이전 구절을 새 내용과 혼합하지 않는다", async () => {
  const newer = { ...evidence, id: "term:2:body:0", revision: 2, excerpt: "정산은 이틀 뒤 실행한다." };
  complete.mockResolvedValueOnce(JSON.stringify({ claims: [], uncertainties: [], followUpQuery: "정산 예외" }))
    .mockResolvedValueOnce(JSON.stringify({ claims: [{ text: "이틀 뒤 실행합니다.", evidenceIds: [newer.id] }], uncertainties: [], followUpQuery: null }));
  retrieve.mockResolvedValueOnce({ ...grounding, sources: [{ ...source, revision: 2 }], evidence: [newer] });
  const result = await answerWithEvidence(config, "정산 예외?", [], grounding, ["정산"]);
  expect(result.grounded.evidence).toEqual([newer]);
  expect(complete.mock.calls[1]?.[1][0].content).not.toContain("다음 영업일");
});

test("잘못된 모델 응답은 근거 없는 일반 답변으로 대체하지 않는다", async () => {
  complete.mockResolvedValueOnce("무조건 오늘 정산합니다.");
  const result = await answerWithEvidence(config, "정산?", [], grounding, ["정산"]);
  expect(result.grounded.claims).toEqual([]);
  expect(result.sources).toEqual([]);
  expect(result.answer).not.toContain("무조건 오늘");
  expect(result.answer).toContain("연결하지 못했습니다");
});

test("구조화 응답이 깨지면 허용된 근거 ID만 사용하는 한 번의 복구를 시도한다", async () => {
  complete.mockResolvedValueOnce("설명과 함께 깨진 응답")
    .mockResolvedValueOnce(JSON.stringify({ claims: [{ text: "정산은 다음 영업일에 실행합니다.", evidenceIds: [evidence.id] }], uncertainties: [], followUpQuery: null }));
  const result = await answerWithEvidence(config, "정산?", [], grounding, ["정산"]);
  expect(result.grounded.claims).toHaveLength(1);
  expect(result.grounded.evidence).toEqual([evidence]);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1]?.[3]).toMatchObject({ context: { operation: "chat.grounded-answer.repair" } });
});
