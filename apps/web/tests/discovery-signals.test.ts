import { expect, test } from "vitest";
import {
  bridgeTerms,
  computeDiscoverySignals,
  domainSilos,
  impliedRelations,
  knowledgeDebt,
  latentLinks,
  type DiscoveryGraph,
  type DiscoveryNode,
} from "../src/lib/discovery/signals.js";
import {
  discoveryMarkdown,
  isAlreadyConnected,
  looksLikeDiscoveryRequest,
  parseCritiques,
  rankIdea,
  validateIdeas,
  parseVerification,
  verificationFactor,
  ideaWikiDraft,
} from "../src/lib/discovery/ideas.js";

function node(id: string, domains: string[], definitionChars = 200, status: DiscoveryNode["status"] = "active"): DiscoveryNode {
  return { id, slug: id.toLowerCase(), name: id, domains, categories: [], definitionChars, status };
}
function edge(source: string, target: string, type = "related_to", confidence = 90) {
  return { id: `${source}-${target}`, source, target, type, confidence };
}

// 광학(ISP)과 제조(FAB) 두 도메인. AE와 SPC는 공통 이웃 둘(Calibration, Sensor)을 두고 관계가 없다.
const graph: DiscoveryGraph = {
  nodes: [
    node("AE", ["광학"]), node("AWB", ["광학"]), node("Lens", ["광학"]),
    node("SPC", ["제조"]), node("Yield", ["제조"]), node("Etch", ["제조"]),
    node("Calibration", ["품질"], 10), node("Sensor", ["품질"]),
  ],
  edges: [
    edge("AE", "Calibration"), edge("SPC", "Calibration"),
    edge("AE", "Sensor"), edge("SPC", "Sensor"),
    edge("AWB", "Calibration"), edge("Yield", "Calibration"),
    edge("Lens", "AE"), edge("Etch", "Yield"),
  ],
  pages: [],
};

test("공통 이웃이 둘 이상인 다른 도메인 용어 쌍을 숨은 연결로 찾고, 이미 관계가 있는 쌍은 제외한다", () => {
  const signals = latentLinks(graph);
  const top = signals.sort((a, b) => b.score - a.score)[0]!;
  expect(new Set(top.termIds)).toEqual(new Set(["AE", "SPC"]));
  expect(top.metrics.crossDomain).toBe(1);
  expect(top.novelty).toBe(1);
  expect(signals.some((signal) => signal.termIds.includes("Lens") && signal.termIds.includes("AE"))).toBe(false);
});

test("공통 이웃이 하나뿐인 쌍은 근거가 약해 숨은 연결로 내지 않는다", () => {
  // AWB와 Yield는 Calibration 하나만 공유한다.
  expect(latentLinks(graph).some((signal) => signal.termIds.includes("AWB") && signal.termIds.includes("Yield"))).toBe(false);
});

test("위키에서 이미 함께 다룬 쌍은 새로움을 낮춘다", () => {
  const withPage = { ...graph, pages: [{ id: "p", slug: "p", title: "AE와 SPC", termIds: ["AE", "SPC"] }] };
  const pair = latentLinks(withPage).find((signal) => signal.termIds.includes("AE") && signal.termIds.includes("SPC"))!;
  expect(pair.metrics.sharedPages).toBe(1);
  expect(pair.novelty).toBeCloseTo(0.6);
});

test("구조적 이웃이 없어도 임베딩 유사도가 높으면 숨은 연결이 된다", () => {
  const signals = latentLinks({ ...graph, similarities: [{ a: "Lens", b: "Etch", score: 0.9 }, { a: "AWB", b: "Etch", score: 0.3 }] });
  expect(signals.some((signal) => signal.termIds.includes("Lens") && signal.termIds.includes("Etch"))).toBe(true);
  expect(signals.some((signal) => signal.termIds.includes("AWB") && signal.termIds.includes("Etch"))).toBe(false);
});

test("이웃이 두 개 이상의 다른 도메인에 걸친 용어를 다리 용어로 본다", () => {
  const bridges = bridgeTerms(graph).map((signal) => signal.termIds[0]);
  expect(bridges).toContain("Calibration");
  expect(bridges).toContain("Sensor");
  expect(bridges).not.toContain("Lens");
});

test("관계 밀도가 낮은 도메인 쌍을 사일로로 보고, 허브 용어를 대표로 붙인다", () => {
  const silos = domainSilos(graph);
  const opticsFab = silos.find((signal) => signal.domains.includes("광학") && signal.domains.includes("제조"))!;
  expect(opticsFab.metrics.crossRelations).toBe(0);
  expect(opticsFab.termIds).toContain("AE");
  // 광학–품질은 관계가 많아 사일로가 아니다.
  expect(silos.some((signal) => signal.domains.includes("광학") && signal.domains.includes("품질"))).toBe(false);
});

test("추이 관계 A→B→C의 기록되지 않은 A–C를 함의된 관계로 찾는다", () => {
  const chain: DiscoveryGraph = {
    nodes: [node("A", ["x"]), node("B", ["x"]), node("C", ["x"]), node("D", ["x"])],
    edges: [edge("A", "B", "is_a"), edge("B", "C", "is_a"), edge("C", "D", "used_in")],
    pages: [],
  };
  const implied = impliedRelations(chain);
  expect(implied.map((signal) => signal.termIds)).toEqual([["A", "B", "C"]]);
  // 추이적이지 않은 관계는 잇지 않는다.
  expect(impliedRelations(chain, ["used_in"])).toEqual([]);
});

test("많이 기대지만 정의가 얕은 용어를 지식 부채로 본다", () => {
  const debt = knowledgeDebt(graph).map((signal) => signal.termIds[0]);
  expect(debt).toContain("Calibration");
  expect(debt).not.toContain("Sensor");
});

test("kind별 상한으로 고르고 주제 용어를 건드리는 신호만 남길 수 있다", () => {
  const all = computeDiscoverySignals(graph, { limitPerKind: 1 });
  const kinds = all.signals.map((signal) => signal.kind);
  expect(new Set(kinds).size).toBe(kinds.length);
  expect(all.stats.terms).toBe(8);

  const focused = computeDiscoverySignals(graph, { focusTermIds: ["Calibration"] });
  expect(focused.signals.length).toBeGreaterThan(0);
  expect(focused.signals.every((signal) => [...signal.termIds, ...signal.viaTermIds].includes("Calibration"))).toBe(true);
  // 어느 신호에도 끼지 않은 잎 용어로 좁히면 비어 있다. 호출자가 전체로 넓힐지 판단한다.
  expect(computeDiscoverySignals(graph, { focusTermIds: ["Etch"] }).signals).toEqual([]);
});

test("모델이 낸 가설에서 없는 근거 id를 지우고, 용어를 둘 미만 인용하면 버린다", () => {
  const ideas = validateIdeas({
    ideas: [
      { title: "AE로 SPC 개선", hypothesis: "h", reasoning: [{ text: "r", evidenceRefs: ["T1", "T2", "T99"] }], termRefs: ["T1", "T2", "T42"], signalRefs: ["S1", "S9"], risks: ["x", 3] },
      { title: "용어 하나", hypothesis: "h", reasoning: [{ text: "r", evidenceRefs: ["T1"] }], termRefs: ["T1"] },
      { title: "근거 없는 추론", hypothesis: "h", reasoning: [{ text: "r", evidenceRefs: ["T77"] }], termRefs: ["T1", "T2"] },
      { title: "AE로  SPC 개선", hypothesis: "중복 제목", reasoning: [{ text: "r", evidenceRefs: ["T1", "T2"] }], termRefs: ["T1", "T2"] },
      "문자열",
    ],
  }, new Set(["T1", "T2"]), new Set(["S1"]));
  expect(ideas).toHaveLength(1);
  expect(ideas[0]!.termRefs.sort()).toEqual(["T1", "T2"]);
  expect(ideas[0]!.signalRefs).toEqual(["S1"]);
  expect(ideas[0]!.reasoning[0]!.evidenceRefs).toEqual(["T1", "T2"]);
  expect(ideas[0]!.risks).toEqual(["x"]);
  expect(validateIdeas("not json", new Set(), new Set())).toEqual([]);
});

test("비평 점수는 1~5로 자르고 범위 밖 index와 중복은 무시한다", () => {
  const critiques = parseCritiques({ reviews: [
    { index: 0, novelty: 9, grounding: 0, feasibility: "4", impact: 3, verdict: "keep", comment: "ok" },
    { index: 0, novelty: 1, grounding: 1, feasibility: 1, impact: 1, verdict: "drop" },
    { index: 5, novelty: 3, grounding: 3, feasibility: 3, impact: 3, verdict: "keep" },
    { index: 1, novelty: 3, grounding: 3, feasibility: 3, impact: 3, verdict: "maybe" },
  ] }, 2);
  expect(critiques.get(0)).toMatchObject({ novelty: 5, grounding: 1, feasibility: 4, verdict: "keep" });
  expect(critiques.get(1)!.verdict).toBe("revise");
  expect(critiques.size).toBe(2);
});

test("drop 판정은 0점, 이미 이어진 연결은 감점, 근거성이 새로움보다 무겁다", () => {
  const critique = (grounding: number, novelty: number, verdict: "keep" | "drop" = "keep") => ({ grounding, novelty, feasibility: 3, impact: 3, verdict, comment: "" });
  expect(rankIdea(critique(5, 5, "drop"), 1, false)).toBe(0);
  expect(rankIdea(critique(4, 4), 1, true)).toBeLessThan(rankIdea(critique(4, 4), 1, false));
  expect(rankIdea(critique(5, 2), 1, false)).toBeGreaterThan(rankIdea(critique(2, 5), 1, false));
  expect(rankIdea(undefined, 0.5, false)).toBeGreaterThan(0);
});

test("인용 용어가 모두 서로 이어져 있을 때만 이미 연결된 것으로 본다", () => {
  const links = new Set(["a|b", "b|c"]);
  const connected = (x: string, y: string) => links.has(x < y ? `${x}|${y}` : `${y}|${x}`);
  expect(isAlreadyConnected(["a", "b"], connected)).toBe(true);
  expect(isAlreadyConnected(["a", "b", "c"], connected)).toBe(false);
  expect(isAlreadyConnected(["a"], connected)).toBe(false);
});

test("새 도전 발굴 요청만 발굴 에이전트로 보낸다", () => {
  for (const text of [
    "용어집을 바탕으로 아직 아무도 시도하지 않은 새로운 도전 과제를 찾아줘",
    "ISP와 제조 사이에 숨은 연결이 있을까?",
    "지식 그래프를 활용해서 혁신 아이디어 좀",
    "새 기회 발굴해줘",
    "find unexplored opportunities in our glossary",
  ]) expect(looksLikeDiscoveryRequest(text), text).toBe(true);
  for (const text of ["AE의 뜻이 뭐야?", "AE와 AWB의 차이를 설명해줘", "새 용어 FOO를 등록하고 싶어", "회의 메모에서 결정 사항을 정리해줘"]) {
    expect(looksLikeDiscoveryRequest(text), text).toBe(false);
  }
});

test("가설이 없으면 마크다운이 이유와 개선 방향을 말한다", () => {
  const text = discoveryMarkdown({ ideas: [], terms: [], dropped: 2, focus: null, stats: { terms: 3, relations: 1, wikiPages: 0, similarities: 0, domains: 1, truncated: false } });
  expect(text).toContain("용어 3개");
  expect(text).toContain("2개를 근거 부족으로 제외");
});

test("관계가 없는 도메인의 사일로 대표는 정의가 있는 용어를 고른다", () => {
  const sparse: DiscoveryGraph = {
    nodes: [node("Empty1", ["AI"], 0), node("Empty2", ["AI"], 0), node("Defined", ["AI"], 300), node("X", ["센서"]), node("Y", ["센서"]), node("Z", ["센서"])],
    edges: [],
    pages: [],
  };
  const [silo] = domainSilos(sparse);
  expect(silo!.termIds).toContain("Defined");
  expect(silo!.termIds.filter((id) => id.startsWith("Empty"))).toHaveLength(1);
});

test("근거 id 없는 검증 판정은 근거 부족으로 낮추고, 반박된 가설은 순위를 크게 내린다", () => {
  const evidence = [{ id: "E1", title: "t", excerpt: "e", slug: "s" }];
  expect(parseVerification({ verdict: "supported", note: "확인", evidenceIds: ["E9"] }, "q", evidence).verdict).toBe("insufficient");
  expect(parseVerification({ verdict: "contradicted", note: "모순", evidenceIds: ["E1"] }, "q", evidence)).toMatchObject({ verdict: "contradicted", citations: [{ id: "E1" }] });
  expect(parseVerification("garbage", "q", evidence).verdict).toBe("insufficient");
  expect(verificationFactor({ query: "q", verdict: "contradicted", note: "", citations: [] })).toBeLessThan(verificationFactor({ query: "q", verdict: "insufficient", note: "", citations: [] }));
  expect(verificationFactor(undefined)).toBe(1);
});

test("가설 위키 초안은 근거 id를 용어 이름으로 풀고, 검증 전임을 밝히며, 실험 결과 칸을 남긴다", () => {
  const draft = ideaWikiDraft({
    title: "AE를 SPC에", hypothesis: "T1의 루프를 T2에 적용", reasoning: [{ text: "T1과 T2는 S1을 공유", evidenceRefs: ["T1", "S1"] }],
    whyNovel: "S1 사일로", signalRefs: ["S1"], termRefs: ["T1", "T2", "T9"], firstExperiment: "2주 파일럿", successMetric: "이탈 30% 감소", risks: [], openQuestions: ["T2 주기는?"],
    verification: { query: "T1 공통성", verdict: "insufficient", note: "근거 없음", citations: [] }, alreadyConnected: false, score: 2,
  }, {
    terms: [
      { ref: "T1", termId: "1", slug: "ae", name: "AE", domains: [], revision: 3, definition: "" },
      { ref: "T2", termId: "2", slug: "spc", name: "SPC", domains: [], revision: 1, definition: "" },
    ],
    signals: [{ ref: "S1", kind: "silo", summary: "광학·제조 사이 관계 없음", termRefs: [], viaRefs: [], novelty: 1, score: 1 }],
  }, new Date("2026-11-17T00:00:00Z"));
  expect(draft.title).toBe("[도전 가설] AE를 SPC에");
  expect(draft.status).toBe("draft");
  expect(draft.termSlugs).toEqual(["ae", "spc"]);
  expect(draft.summary).toBe("AE의 루프를 SPC에 적용");
  expect(draft.content).toContain("검증 전 가설");
  expect(draft.content).toContain("[AE](/g/ae)");
  expect(draft.content).toContain("SPC 주기는?");
  expect(draft.content).toContain("판정: **근거 부족**");
  expect(draft.content).toContain("[S1] 도메인 사일로: 광학·제조 사이 관계 없음");
  expect(draft.content).toContain("## 실험 결과");
  expect(draft.content).not.toMatch(/\bT\d+\b/);
});

test("유사도가 거의 1인 쌍은 변형·중복 후보로 보고 새로움을 크게 낮춘다", () => {
  const signals = latentLinks({ ...graph, similarities: [{ a: "Lens", b: "Etch", score: 0.7 }, { a: "AWB", b: "Etch", score: 0.99 }] });
  const resonance = signals.find((signal) => signal.termIds.includes("Lens") && signal.termIds.includes("Etch"))!;
  const variant = signals.find((signal) => signal.termIds.includes("AWB") && signal.termIds.includes("Etch"))!;
  expect(variant.metrics.nearDuplicate).toBe(1);
  expect(variant.novelty).toBeLessThan(resonance.novelty);
  expect(variant.summary).toContain("중복·변형");
});
