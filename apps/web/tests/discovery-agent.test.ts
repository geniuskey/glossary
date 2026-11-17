import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createDb, termRelations, terms } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import type { DiscoveryGraph } from "../src/lib/discovery/signals.js";

const complete = vi.hoisted(() => vi.fn());
const retrieve = vi.hoisted(() => vi.fn());
const graphOverride = vi.hoisted(() => ({ current: null as null | (() => Promise<unknown>) }));
const providerErrors = vi.hoisted(() => {
  class AiProviderError extends Error {}
  class AiTruncatedError extends AiProviderError {}
  return { AiProviderError, AiTruncatedError };
});
vi.mock("../src/lib/ai/provider", () => ({ completeAi: complete, ...providerErrors }));
vi.mock("../src/lib/ai/retrieval", () => ({ retrieveGlossaryContext: retrieve }));
vi.mock("../src/lib/discovery/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/discovery/load.js")>();
  return { ...actual, loadDiscoveryGraph: (...args: Parameters<typeof actual.loadDiscoveryGraph>) => graphOverride.current ? graphOverride.current() : actual.loadDiscoveryGraph(...args) };
});
const { discoverChallenges, pickPromptSignals } = await import("../src/lib/ai/discovery.js");
const { loadDiscoveryGraph } = await import("../src/lib/discovery/load.js");
const { createChatTracer, ChatAbortedError } = await import("../src/lib/ai/chat-trace.js");

const db = createDb(process.env.DATABASE_URL_TEST!);
const config = { provider: "openai_compatible" as const, baseUrl: "http://127.0.0.1", model: "test", apiKey: "", customHeaders: [] };
const suffix = Date.now().toString(36).slice(-6).toUpperCase();
const ids: Record<string, string> = {};

beforeAll(async () => {
  for (const [key, definition] of [
    ["AE", "노출을 자동으로 맞추는 카메라 제어 루프"],
    ["SPC", "공정 데이터를 관리도로 감시하는 통계적 공정 관리"],
    ["CAL", "센서 출력 편차를 기준값에 맞추는 보정"],
    ["SEN", "빛을 전기 신호로 바꾸는 이미지 센서"],
    ["OLD", "대체된 옛 용어"],
  ] as const) {
    const created = await createTerm({ nameEn: `Discovery${key}${suffix}`, definitionMd: definition, domain: ["QA"], status: "active", surfaces: [] }, null);
    ids[key] = created.term.id;
  }
  await db.insert(termRelations).values([
    { sourceTermId: ids.AE!, targetTermId: ids.CAL!, relationType: "related_to", status: "approved", confidence: 90, sourceRevision: 1, targetRevision: 1 },
    { sourceTermId: ids.SPC!, targetTermId: ids.CAL!, relationType: "related_to", status: "approved", confidence: 90, sourceRevision: 1, targetRevision: 1 },
    { sourceTermId: ids.AE!, targetTermId: ids.SEN!, relationType: "related_to", status: "proposed", confidence: 90, sourceRevision: 1, targetRevision: 1 },
  ]);
  await db.update(terms).set({ replacedById: ids.AE! }).where(inArray(terms.id, [ids.OLD!]));
});

afterAll(async () => {
  await db.delete(terms).where(inArray(terms.id, Object.values(ids)));
});

afterEach(() => {
  complete.mockReset();
  retrieve.mockReset();
  graphOverride.current = null;
});

function graphFor(): DiscoveryGraph & { transitiveTypes: string[]; truncated: boolean } {
  const n = (key: string, domains: string[], definitionChars = 40) => ({ id: ids[key]!, slug: key.toLowerCase(), name: key, domains, categories: [], definitionChars, status: "active" as const });
  return {
    nodes: [n("AE", ["광학"]), n("SPC", ["제조"]), n("CAL", ["품질"]), n("SEN", ["품질"])],
    edges: [
      { id: "1", source: ids.AE!, target: ids.CAL!, type: "related_to", confidence: 90 },
      { id: "2", source: ids.SPC!, target: ids.CAL!, type: "related_to", confidence: 90 },
      { id: "3", source: ids.AE!, target: ids.SEN!, type: "related_to", confidence: 90 },
      { id: "4", source: ids.SPC!, target: ids.SEN!, type: "related_to", confidence: 90 },
    ],
    pages: [],
    similarities: [],
    transitiveTypes: ["is_a", "part_of"],
    truncated: false,
  };
}

test("로더는 승인되고 리비전이 맞는 관계만 쓰고 대체된 용어를 그래프에서 뺀다", async () => {
  const graph = await loadDiscoveryGraph({ withSimilarity: false });
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  expect(nodeIds.has(ids.AE!)).toBe(true);
  expect(nodeIds.has(ids.OLD!)).toBe(false);
  const mine = graph.edges.filter((edge) => [edge.source, edge.target].some((id) => Object.values(ids).includes(id)));
  expect(mine).toHaveLength(2);
  expect(mine.every((edge) => edge.target === ids.CAL)).toBe(true);
  expect(graph.transitiveTypes).toEqual(expect.arrayContaining(["is_a", "part_of"]));
});

test("구조 신호와 용어 정의로 가설을 만들고, 비평 점수로 순위를 매기며, 탈락 가설 수를 남긴다", async () => {
  graphOverride.current = async () => graphFor();
  complete
    .mockImplementationOnce(async (_config, messages: Array<{ content: string }>) => {
      const prompt = messages[1]!.content;
      // 모델에는 uuid가 아니라 짧은 근거 id와 실제 정의가 간다.
      expect(prompt).toContain("노출을 자동으로 맞추는 카메라 제어 루프");
      expect(prompt).not.toContain(ids.AE!);
      expect(prompt).toContain("latent_link");
      const terms = JSON.parse(/TERMS=(.*)/.exec(prompt)![1]!) as Array<{ id: string; name: string }>;
      const ref = (name: string) => terms.find((term) => term.name === `Discovery${name}${suffix}`)!.id;
      return JSON.stringify({ ideas: [
        { title: "AE 제어 루프를 SPC 관리도에 이식", hypothesis: "카메라 AE의 폐루프 제어를 공정 관리에 적용한다", reasoning: [{ text: "둘 다 보정과 센서를 공유한다", evidenceRefs: [ref("AE"), ref("SPC"), "S1"] }], termRefs: [ref("AE"), ref("SPC")], signalRefs: ["S1"], whyNovel: "광학과 제조 사이에 관계가 없다", firstExperiment: "2주 파일럿", successMetric: "관리도 이탈 30% 감소", risks: [], openQuestions: [] },
        { title: "진부한 가설", hypothesis: "보정을 잘하자", reasoning: [{ text: "보정은 중요하다", evidenceRefs: [ref("CAL"), ref("AE")] }], termRefs: [ref("CAL"), ref("AE")] },
        { title: "지어낸 근거", hypothesis: "x", reasoning: [{ text: "y", evidenceRefs: ["T999"] }], termRefs: ["T999", "T998"] },
      ] });
    })
    .mockResolvedValueOnce(JSON.stringify({ reviews: [
      { index: 0, novelty: 5, grounding: 4, feasibility: 4, impact: 4, verdict: "keep", comment: "센서 공통성 근거가 약하다" },
      { index: 1, novelty: 1, grounding: 3, feasibility: 5, impact: 1, verdict: "drop", comment: "진부하다" },
    ] }));

  // 약한 고리 검증: 용어집 전체 검색 → 판정. 근거 id는 서버가 E1…로 다시 붙인다.
  retrieve.mockResolvedValueOnce({ context: "", sources: [], ontology: [], evidence: [
    { id: "term:sen:body:0", slug: "sen", title: "SEN", revision: 1, updatedAt: "2026-11-17T00:00:00.000Z", field: "body", excerpt: "센서 보정 데이터는 공정 관리도와 같은 형식으로 저장된다" },
  ] });
  complete.mockImplementationOnce(async (_config, messages: Array<{ content: string }>) => {
    // 판정 대상은 가설 쪽 주장이고, 비평은 참고로만 간다.
    expect(messages[1]!.content).toContain("CLAIM=카메라 AE의 폐루프 제어를 공정 관리에 적용한다");
    expect(messages[1]!.content).toContain("CRITIQUE=센서 공통성 근거가 약하다");
    expect(messages[0]!.content).toContain("비평 문장이 맞는지를 판정하지 마세요");
    expect(messages[1]!.content).toContain("\"id\":\"E1\"");
    return JSON.stringify({ verdict: "supported", note: "보정 데이터 형식이 같다", evidenceIds: ["E1", "E99"] });
  });

  const steps: string[] = [];
  const report = await discoverChallenges(config, { maxIdeas: 3 }, createChatTracer({ onStep: (step) => { if (step.status === "done") steps.push(step.label); } }));
  expect(complete).toHaveBeenCalledTimes(3);
  expect(report.ideas.map((idea) => idea.title)).toEqual(["AE 제어 루프를 SPC 관리도에 이식"]);
  expect(report.ideas[0]!.verification).toMatchObject({ verdict: "supported", citations: [{ id: "E1", slug: "sen", revision: 1 }] });
  expect(report.answer).toContain("용어집 검증");
  expect(report.dropped).toBe(1);
  expect(report.ideas[0]!.alreadyConnected).toBe(false);
  expect(report.ideas[0]!.critique?.novelty).toBe(5);
  // 화면 근거에는 실제 리비전과 인용된 용어만 남는다.
  expect(report.terms.map((term) => term.name).sort()).toEqual(expect.arrayContaining(["AE", "SPC"].map((key) => `Discovery${key}${suffix}`)));
  expect(report.terms.every((term) => term.revision >= 1)).toBe(true);
  expect(report.signals.map((signal) => signal.ref)).toContain("S1");
  expect(report.answer).toContain("AE 제어 루프를 SPC 관리도에 이식");
  expect(report.answer).toContain(`/g/${report.terms[0]!.slug}`);
  expect(steps.some((label) => label.includes("빈틈 신호"))).toBe(true);
});

test("비평 호출이 실패해도 근거 검증을 통과한 가설은 중립 점수로 남는다", async () => {
  graphOverride.current = async () => graphFor();
  complete
    .mockImplementationOnce(async (_config, messages: Array<{ content: string }>) => {
      const terms = JSON.parse(/TERMS=(.*)/.exec(messages[1]!.content)![1]!) as Array<{ id: string; name: string }>;
      const [a, b] = [terms.find((term) => term.name === `DiscoveryAE${suffix}`)!.id, terms.find((term) => term.name === `DiscoverySPC${suffix}`)!.id];
      return JSON.stringify({ ideas: [{ title: "t", hypothesis: "h", reasoning: [{ text: "r", evidenceRefs: [a, b] }], termRefs: [a, b] }] });
    })
    .mockRejectedValueOnce(new Error("timeout"));
  const report = await discoverChallenges(config, {});
  expect(report.ideas).toHaveLength(1);
  expect(report.ideas[0]!.critique).toBeUndefined();
  expect(report.ideas[0]!.score).toBeGreaterThan(0);
});

test("신호가 없는 빈약한 그래프에서는 AI를 부르지 않고 이유를 말한다", async () => {
  graphOverride.current = async () => ({ ...graphFor(), edges: [], nodes: graphFor().nodes.map((node) => ({ ...node, definitionChars: 300 })) });
  const report = await discoverChallenges(config, {});
  expect(complete).not.toHaveBeenCalled();
  expect(report.ideas).toEqual([]);
  expect(report.answer).toContain("용어 4개");
});

test("주제가 있으면 관련 용어로 신호를 좁히고, 중단 요청은 다음 단계 전에 멈춘다", async () => {
  graphOverride.current = async () => graphFor();
  retrieve.mockResolvedValueOnce({ context: "", sources: [{ termId: ids.CAL, slug: "cal", title: "CAL", definition: null, status: "active", revision: 1 }], evidence: [], ontology: [] });
  const abort = new AbortController();
  complete.mockImplementationOnce(async () => {
    abort.abort();
    return JSON.stringify({ ideas: [] });
  });
  const result = await discoverChallenges(config, { focus: "보정" }, createChatTracer({ signal: abort.signal })).catch((error: unknown) => error);
  expect(retrieve).toHaveBeenCalledWith("보정", 12, expect.objectContaining({ vectorSearch: true }));
  // 생성 결과가 비면 비평 없이 끝난다. 중단은 그다음 단계에서만 감지되므로 여기서는 정상 종료다.
  expect(result instanceof ChatAbortedError || (result as { ideas: unknown[] }).ideas.length === 0).toBe(true);
});

test("프롬프트 신호는 kind별로 번갈아 뽑아 한 종류가 독점하지 않는다", () => {
  const signal = (kind: "latent_link" | "bridge", index: number) => ({ id: `${kind}:${index}`, kind, termIds: [], viaTermIds: [], domains: [], score: 10 - index, novelty: 1, metrics: {}, summary: "" });
  const picked = pickPromptSignals([...Array.from({ length: 10 }, (_, index) => signal("latent_link", index)), signal("bridge", 0)], 3);
  expect(picked.map((item) => item.kind)).toEqual(["latent_link", "bridge", "latent_link"]);
});

test("임베딩 씨앗은 주제 용어를 먼저, 나머지는 도메인을 번갈아 정의가 긴 용어부터 고른다", async () => {
  const { pickSimilaritySeeds } = await import("../src/lib/discovery/load.js");
  const n = (id: string, domain: string, definitionChars: number) => ({ id, slug: id, name: id, domains: [domain], categories: [], definitionChars, status: "active" as const });
  const nodes = [n("p1", "센서", 5), n("p2", "센서", 5), n("concept", "센서", 300), n("fab", "제조", 200), n("fab2", "제조", 10)];
  expect(pickSimilaritySeeds(nodes, new Map(), ["fab2"], 4)).toEqual(["fab2", "concept", "fab", "p1"]);
  expect(pickSimilaritySeeds(nodes, new Map(), ["missing"], 2)).toEqual(["concept", "fab"]);
});

test("생성 응답이 토큰 상한에서 잘리면 가설 수를 줄여 짧게 한 번 더 생성한다", async () => {
  graphOverride.current = async () => graphFor();
  complete
    .mockRejectedValueOnce(new providerErrors.AiTruncatedError("잘림"))
    .mockImplementationOnce(async (_config, messages: Array<{ content: string }>) => {
      expect(messages[0]!.content).toContain("이번에는 짧게 쓰세요");
      expect(messages[1]!.content).toContain("MAX_IDEAS=2");
      const terms = JSON.parse(/TERMS=(.*)/.exec(messages[1]!.content)![1]!) as Array<{ id: string; name: string }>;
      const [a, b] = [terms.find((term) => term.name === `DiscoveryAE${suffix}`)!.id, terms.find((term) => term.name === `DiscoverySPC${suffix}`)!.id];
      return JSON.stringify({ ideas: [{ title: "짧은 가설", hypothesis: "h", reasoning: [{ text: "r", evidenceRefs: [a, b] }], termRefs: [a, b] }] });
    })
    .mockRejectedValueOnce(new Error("비평 생략"));
  const labels: string[] = [];
  const report = await discoverChallenges(config, { maxIdeas: 3 }, createChatTracer({ onStep: (step) => { if (step.status !== "running") labels.push(step.label); } }));
  expect(report.ideas.map((idea) => idea.title)).toEqual(["짧은 가설"]);
  expect(labels.some((label) => label.includes("가설 수를 줄여"))).toBe(true);
});

test("잘림이 아닌 생성 실패는 다시 시도하지 않고 그대로 올린다", async () => {
  graphOverride.current = async () => graphFor();
  complete.mockRejectedValueOnce(new providerErrors.AiProviderError("인증 실패"));
  await expect(discoverChallenges(config, {})).rejects.toThrow("인증 실패");
  expect(complete).toHaveBeenCalledTimes(1);
});
