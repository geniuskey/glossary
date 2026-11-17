import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import type { ChatEvidence } from "../src/lib/ai/grounding-values.js";

const complete = vi.hoisted(() => vi.fn());
const retrieve = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/ai/provider", () => ({ completeAi: complete }));
vi.mock("../src/lib/ai/retrieval", () => ({ retrieveGlossaryContext: retrieve }));
const { researchGlossary, pickNewSearches, parseResearchPlan, combineResearch, MAX_RESEARCH_ROUNDS } = await import("../src/lib/ai/research.js");
const { fitEvidenceBudget } = await import("../src/lib/ai/grounded-answer.js");
const { createChatTracer, ChatAbortedError } = await import("../src/lib/ai/chat-trace.js");
const { summarizeTrace, upsertTraceStep } = await import("../src/lib/ai/chat-trace-values.js");

const config = { provider: "openai_compatible" as const, baseUrl: "http://127.0.0.1", model: "test", apiKey: "", customHeaders: [] };
afterEach(() => { complete.mockReset(); retrieve.mockReset(); });

function hit(slug: string, title: string) {
  const evidence: ChatEvidence = { id: `term:${slug}:definition:0`, slug, title, revision: 1, updatedAt: "2026-11-17T00:00:00.000Z", field: "definition", excerpt: `${title} 정의` };
  return { context: "", sources: [{ slug, title, definition: `${title} 정의`, status: "active" as const, revision: 1 }], evidence: [evidence], ontology: [] };
}
const empty = { context: "", sources: [], evidence: [], ontology: [] };

test("이미 쓴 검색어는 대소문자·공백만 달라도 다시 돌리지 않는다", () => {
  expect(pickNewSearches(["  ae ", "Auto  Exposure", "auto exposure", "AWB", "ISP"], ["AE"], 2)).toEqual(["Auto  Exposure", "AWB"]);
  expect(pickNewSearches(["", "AE"], ["ae"])).toEqual([]);
});

test("계획 응답이 JSON이 아니면 null로 보고 루프가 스스로 멈춘다", () => {
  expect(parseResearchPlan("모르겠습니다")).toBeNull();
  expect(parseResearchPlan(undefined)).toBeNull();
  expect(parseResearchPlan(JSON.stringify({ done: false, thought: "AWB도 찾습니다.", searches: ["AWB"] }))).toMatchObject({ done: false, searches: ["AWB"] });
});

test("계획이 길이 상한을 넘으면 버리지 않고 잘라서 쓴다", () => {
  const plan = parseResearchPlan(JSON.stringify({ done: false, thought: "가".repeat(900), searches: ["AWB", 3, " ", ...Array.from({ length: 8 }, (_, index) => `검색${index}`)] }));
  expect(plan).not.toBeNull();
  expect(plan!.thought).toHaveLength(400);
  expect(plan!.searches).toEqual(["AWB", "검색0", "검색1", "검색2", "검색3", "검색4"]);
});

test("검색 결과는 검색별로 번갈아 합쳐, 첫 검색이 근거 예산을 다 채워도 추가 검색의 근거가 남는다", () => {
  const many = (slug: string, title: string, count: number) => {
    const base = hit(slug, title);
    return { ...base, evidence: Array.from({ length: count }, (_, index) => ({ ...base.evidence[0]!, id: `term:${slug}:definition:${index}`, excerpt: "가".repeat(10_000) })) };
  };
  const combined = combineResearch([many("ae", "AE", 6), many("awb", "AWB", 1)]);
  expect(combined.evidence?.slice(0, 3).map((item) => item.slug)).toEqual(["ae", "awb", "ae"]);
  expect(fitEvidenceBudget(combined.evidence ?? []).map((item) => item.slug)).toContain("awb");
});

test("비교 질문은 부족한 대상을 추가로 찾고, 찾은 근거를 합쳐 넘긴다", async () => {
  retrieve.mockResolvedValueOnce(hit("ae", "AE")).mockResolvedValueOnce(hit("awb", "AWB"));
  complete
    .mockResolvedValueOnce(JSON.stringify({ done: false, thought: "AE는 찾았고 AWB를 더 찾습니다.", searches: ["ae", "AWB"] }))
    .mockResolvedValueOnce(JSON.stringify({ done: true, thought: "두 용어의 정의를 모두 찾았습니다.", searches: [] }));
  const tracer = createChatTracer();
  const result = await researchGlossary(config, "AE와 AWB 차이?", [], "AE", { domain: "ISP" }, tracer);
  expect(result.queries).toEqual(["AE", "AWB"]);
  expect(retrieve).toHaveBeenCalledTimes(2);
  expect(retrieve.mock.calls[1]?.[2]).toMatchObject({ domain: "ISP", passageQuery: "AE와 AWB 차이?\nAWB" });
  expect(result.grounding.evidence?.map((item) => item.slug)).toEqual(["ae", "awb"]);
  // 두 번째 계획은 첫 검색에서 찾은 근거를 보고 판단해야 한다.
  expect(complete.mock.calls[1]?.[1][0].content).toContain("AWB 정의");
  expect(tracer.steps.map((step) => step.kind)).toEqual(["search", "plan", "search", "plan"]);
  expect(tracer.steps[1]).toMatchObject({ status: "done", detail: "AE는 찾았고 AWB를 더 찾습니다." });
  expect(tracer.steps[2]).toMatchObject({ label: "“AWB” 검색", resultCount: 1, detail: "AWB" });
});

test("모델이 계속 더 찾자고 해도 라운드 상한에서 멈춘다", async () => {
  retrieve.mockResolvedValue(empty);
  let round = 0;
  complete.mockImplementation(async () => JSON.stringify({ done: false, thought: "더 찾습니다.", searches: [`검색어${round++}`] }));
  const result = await researchGlossary(config, "아무거나", [], "첫 검색", {}, createChatTracer());
  expect(complete).toHaveBeenCalledTimes(MAX_RESEARCH_ROUNDS);
  expect(result.queries).toHaveLength(MAX_RESEARCH_ROUNDS + 1);
});

test("중단하면 다음 계획 호출 전에 멈춘다", async () => {
  const abort = new AbortController();
  retrieve.mockImplementationOnce(async () => {
    abort.abort();
    return hit("ae", "AE");
  });
  const tracer = createChatTracer({ signal: abort.signal });
  await expect(researchGlossary(config, "AE?", [], "AE", {}, tracer)).rejects.toBeInstanceOf(ChatAbortedError);
  expect(complete).not.toHaveBeenCalled();
});

test("진행 단계는 다음 단계가 시작되면 닫히고, 전체 시간은 병렬 검색을 겹쳐 세지 않는다", () => {
  let clock = 0;
  const events: string[] = [];
  const tracer = createChatTracer({ onStep: (step) => events.push(`${step.id}:${step.status}`) }, () => clock);
  tracer.task("요청 파악");
  clock = 100;
  const first = tracer.start("search", "A");
  const second = tracer.start("search", "B");
  clock = 400;
  tracer.finish(first);
  tracer.finish(second);
  expect(events).toEqual(["1:running", "1:done", "2:running", "3:running", "2:done", "3:done"]);
  expect(summarizeTrace(tracer.steps)).toEqual({ searches: 2, durationMs: 400 });
  tracer.start("answer", "답변");
  tracer.close("failed");
  expect(tracer.steps.at(-1)?.status).toBe("failed");
});

test("같은 단계 이벤트가 다시 와도 목록이 늘지 않는다", () => {
  const running = { id: 1, kind: "search" as const, label: "A", status: "running" as const };
  const once = upsertTraceStep([], running);
  expect(upsertTraceStep(once, { ...running, status: "done" })).toEqual([{ ...running, status: "done" }]);
});

test("챗 스트림은 세션을 먼저 알리고, 중단이 서버 단계까지 전달된다", () => {
  const route = readFileSync(new URL("../src/app/api/v1/chat/route.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/chat-panel.tsx", import.meta.url), "utf8");
  expect(route).toContain('send({ type: "session", sessionId: conversationId })');
  expect(route).toMatch(/cancel\(\) \{\s*streamClosed = true;\s*abort\.abort\(\);/);
  expect(route).toContain("trace: stored?.trace");
  expect(panel).toContain("signal: abort.signal");
  expect(panel).toContain('event.type === "step"');
  expect(panel).toContain('event.type === "session"');
});
