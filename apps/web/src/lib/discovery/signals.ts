/**
 * 용어 그래프의 구조에서 "사람이 아직 잇지 않은 곳"을 찾는 결정적 신호.
 *
 * LLM에게 용어집 전체를 주고 새 도전을 떠올리라고 하면 유명한 용어 몇 개를 일반 지식으로
 * 엮은 그럴듯한 문장이 나온다. 조직 고유의 빈틈은 그래프 구조(누가 누구와 이어지지 않았는가)에
 * 있으므로, 먼저 구조로 후보를 좁히고 모델은 그 후보를 근거와 함께 해석하게 한다.
 * 이 모듈은 DB·AI를 모르는 순수 함수라서 외부 에이전트용 API와 내부 발굴 에이전트가 같은
 * 규칙을 공유하고, 테스트로 점수 규칙을 잠근다.
 */

export interface DiscoveryNode {
  id: string;
  slug: string;
  name: string;
  domains: readonly string[];
  categories: readonly string[];
  definitionChars: number;
  status: "draft" | "active";
}

export interface DiscoveryEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  confidence: number;
}

/** 공개 위키 한 문서가 함께 다루는 용어 묶음. 사람이 이미 같이 논의한 흔적이다. */
export interface DiscoveryPage {
  id: string;
  slug: string;
  title: string;
  termIds: readonly string[];
}

/** 임베딩 코사인 유사도. RAG가 꺼져 있으면 비어 있고, 신호는 구조만으로도 동작한다. */
export interface DiscoverySimilarity {
  a: string;
  b: string;
  score: number;
}

export interface DiscoveryGraph {
  nodes: readonly DiscoveryNode[];
  edges: readonly DiscoveryEdge[];
  pages: readonly DiscoveryPage[];
  similarities?: readonly DiscoverySimilarity[];
}

export const DISCOVERY_SIGNAL_KINDS = ["latent_link", "bridge", "silo", "implied", "knowledge_debt"] as const;
export type DiscoverySignalKind = (typeof DISCOVERY_SIGNAL_KINDS)[number];

export interface DiscoverySignal {
  id: string;
  kind: DiscoverySignalKind;
  /** 신호를 이루는 용어. latent_link는 [a, b], implied는 [a, b, c] 경로 순서. */
  termIds: string[];
  /** latent_link의 공통 이웃처럼 신호를 뒷받침하는 중간 용어. */
  viaTermIds: string[];
  domains: string[];
  /** 같은 kind 안에서만 비교 가능한 상대 점수. */
  score: number;
  /** 0~1. 사람이 이미 함께 다룬 흔적(관계·위키 동시 언급·같은 도메인)이 적을수록 높다. */
  novelty: number;
  metrics: Record<string, number>;
  /** implied 신호가 함의하는 관계 종류. 관계 제안으로 바꿀 때 쓴다. */
  relationType?: string;
  /** 사람에게 보이는 한국어 한 문장. 모델이 아니라 규칙이 만든다. */
  summary: string;
}

export interface DiscoveryOptions {
  /** 추이 관계로 취급할 관계 종류. 온톨로지 카탈로그의 transitive 선언에서 온다. */
  transitiveTypes?: readonly string[];
  /** 이 용어를 건드리는 신호만 남긴다. 주제 중심 발굴에 쓴다. */
  focusTermIds?: readonly string[];
  limitPerKind?: number;
}

const DEFAULT_TRANSITIVE = ["is_a", "part_of"];
// 연결이 아주 많은 허브를 공통 이웃으로 쓰면 무관한 쌍이 수만 개 생기고(허브 차수의 제곱),
// "둘 다 '시스템'과 관련됨" 같은 의미 없는 근거가 상위를 채운다. Adamic–Adar도 허브 가중을
// 낮추지만 열거 비용 자체를 막지는 못한다.
const MAX_HUB_DEGREE_FOR_PAIRS = 60;
// 용어를 수십 개 링크한 위키(색인·용어 목록 문서)는 동시 언급이라는 의미가 없다.
const MAX_PAGE_TERMS_FOR_PAIRS = 25;
const SIMILARITY_FLOOR = 0.55;
export const NEAR_DUPLICATE_SIMILARITY = 0.93;

function round(value: number, digits = 3): number {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function disjoint(a: readonly string[], b: readonly string[]): boolean {
  if (!a.length || !b.length) return false;
  const set = new Set(a);
  return !b.some((item) => set.has(item));
}

interface GraphIndex {
  byId: Map<string, DiscoveryNode>;
  neighbors: Map<string, Set<string>>;
  pageCount: Map<string, number>;
}

function indexGraph(graph: DiscoveryGraph): GraphIndex {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, Set<string>>(graph.nodes.map((node) => [node.id, new Set()]));
  for (const edge of graph.edges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const pageCount = new Map<string, number>();
  for (const page of graph.pages) for (const id of new Set(page.termIds)) pageCount.set(id, (pageCount.get(id) ?? 0) + 1);
  return { byId, neighbors, pageCount };
}

function nameOf(index: GraphIndex, id: string): string {
  return index.byId.get(id)?.name ?? id;
}

/** 공통 이웃·위키 동시 언급·임베딩 유사도로 아직 관계가 없는 용어 쌍을 찾는다. */
export function latentLinks(graph: DiscoveryGraph, index = indexGraph(graph)): DiscoverySignal[] {
  const candidates = new Map<string, { a: string; b: string; via: Set<string>; adamicAdar: number; sharedPages: number; similarity: number }>();
  const touch = (a: string, b: string) => {
    if (a === b || !index.byId.has(a) || !index.byId.has(b) || index.neighbors.get(a)!.has(b)) return null;
    const key = pairKey(a, b);
    let entry = candidates.get(key);
    if (!entry) {
      entry = { a: a < b ? a : b, b: a < b ? b : a, via: new Set(), adamicAdar: 0, sharedPages: 0, similarity: 0 };
      candidates.set(key, entry);
    }
    return entry;
  };

  for (const [hub, around] of index.neighbors) {
    if (around.size < 2 || around.size > MAX_HUB_DEGREE_FOR_PAIRS) continue;
    const weight = 1 / Math.log(1 + around.size);
    const list = [...around];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const entry = touch(list[i]!, list[j]!);
        if (!entry) continue;
        entry.via.add(hub);
        entry.adamicAdar += weight;
      }
    }
  }
  for (const page of graph.pages) {
    const ids = [...new Set(page.termIds)].filter((id) => index.byId.has(id));
    if (ids.length < 2 || ids.length > MAX_PAGE_TERMS_FOR_PAIRS) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const entry = touch(ids[i]!, ids[j]!);
        if (entry) entry.sharedPages += 1;
      }
    }
  }
  for (const pair of graph.similarities ?? []) {
    if (pair.score < SIMILARITY_FLOOR) continue;
    const entry = touch(pair.a, pair.b);
    if (entry) entry.similarity = Math.max(entry.similarity, pair.score);
  }

  const signals: DiscoverySignal[] = [];
  for (const entry of candidates.values()) {
    const a = index.byId.get(entry.a)!;
    const b = index.byId.get(entry.b)!;
    const crossDomain = disjoint(a.domains, b.domains);
    // 공통 이웃이 하나뿐이고 다른 근거가 없으면 "같은 허브에 매달린 두 잎"일 뿐이다.
    if (entry.via.size < 2 && entry.sharedPages === 0 && entry.similarity === 0) continue;
    // 동시 언급은 로그로 줄인다. 선형이면 위키 수십 건에 함께 나오는 사실상의 동의어 쌍(Image Sensor·CIS,
    // 실데이터 47건)이 상위를 독차지했다. 그런 쌍은 새 도전이 아니라 관계·표기 정리 대상이다.
    const support = entry.adamicAdar + 0.6 * Math.log2(1 + entry.sharedPages) + 3 * Math.max(0, entry.similarity - 0.5);
    // 위키에서 이미 함께 다뤘다면 사람이 아는 연결이다. 공식 관계로 정리할 가치는 있지만 새롭지는 않다.
    // 유사도가 거의 1인 쌍은 같은 개념의 변형(제품 파생형 GC02M1·GC02M1B 등, 실데이터 상위를 독차지)이다.
    // 새 결합이 아니라 중복·변형 정리 대상이므로 새로움을 크게 낮춘다.
    const nearDuplicate = entry.similarity >= NEAR_DUPLICATE_SIMILARITY;
    const novelty = (crossDomain ? 1 : 0.55) * (entry.sharedPages > 0 ? 0.6 : 1) * (nearDuplicate ? 0.25 : 1);
    const via = [...entry.via].sort((x, y) => (index.neighbors.get(x)!.size - index.neighbors.get(y)!.size) || x.localeCompare(y)).slice(0, 4);
    const reasons = [
      entry.via.size ? `공통 이웃 ${entry.via.size}개(${via.map((id) => nameOf(index, id)).join(", ")})` : "",
      entry.sharedPages ? `공개 위키 ${entry.sharedPages}건에서 함께 언급` : "",
      entry.similarity ? `의미 유사도 ${entry.similarity.toFixed(2)}` : "",
    ].filter(Boolean).join(", ");
    signals.push({
      id: `latent_link:${entry.a}:${entry.b}`,
      kind: "latent_link",
      termIds: [entry.a, entry.b],
      viaTermIds: via,
      domains: [...new Set([...a.domains, ...b.domains])],
      score: round(support * novelty),
      novelty: round(novelty),
      metrics: {
        commonNeighbors: entry.via.size,
        adamicAdar: round(entry.adamicAdar),
        sharedPages: entry.sharedPages,
        similarity: round(entry.similarity),
        crossDomain: crossDomain ? 1 : 0,
        nearDuplicate: nearDuplicate ? 1 : 0,
      },
      summary: `${a.name}·${b.name}${crossDomain ? "(서로 다른 도메인)" : ""}: ${reasons}. ${nearDuplicate ? "거의 같은 개념이라 중복·변형 여부를 먼저 확인할 쌍입니다." : "둘 사이에 승인된 관계는 없습니다."}`,
    });
  }
  return signals;
}

/** 이웃이 여러 다른 도메인에 걸친 용어. 한 조직의 지식이 도메인을 건너가는 통로다. */
export function bridgeTerms(graph: DiscoveryGraph, index = indexGraph(graph)): DiscoverySignal[] {
  const signals: DiscoverySignal[] = [];
  for (const node of graph.nodes) {
    const around = index.neighbors.get(node.id)!;
    if (around.size < 2) continue;
    const own = new Set(node.domains);
    const reached = new Map<string, number>();
    for (const id of around) {
      for (const domain of index.byId.get(id)!.domains) if (!own.has(domain)) reached.set(domain, (reached.get(domain) ?? 0) + 1);
    }
    if (reached.size < 2) continue;
    const domains = [...reached.keys()].sort((x, y) => reached.get(y)! - reached.get(x)! || x.localeCompare(y));
    signals.push({
      id: `bridge:${node.id}`,
      kind: "bridge",
      termIds: [node.id],
      viaTermIds: [...around].slice(0, 6),
      domains: [...node.domains, ...domains],
      score: round(reached.size + 0.5 * Math.log(1 + around.size)),
      novelty: round(Math.min(1, reached.size / 4)),
      metrics: { degree: around.size, reachedDomains: reached.size },
      summary: `다리 용어 ${node.name}: 관계를 통해 ${domains.slice(0, 4).join(", ")}${domains.length > 4 ? ` 외 ${domains.length - 4}개` : ""} 도메인에 닿습니다.`,
    });
  }
  return signals;
}

/** 각자 용어가 충분한데 서로 관계가 거의 없는 도메인 쌍. 조직의 사일로 후보다. */
export function domainSilos(graph: DiscoveryGraph, index = indexGraph(graph), minTerms = 3): DiscoverySignal[] {
  const members = new Map<string, string[]>();
  for (const node of graph.nodes) for (const domain of node.domains) members.set(domain, [...(members.get(domain) ?? []), node.id]);
  const cross = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = index.byId.get(edge.source);
    const b = index.byId.get(edge.target);
    if (!a || !b) continue;
    for (const da of a.domains) for (const db of b.domains) if (da !== db) cross.set(pairKey(da, db), (cross.get(pairKey(da, db)) ?? 0) + 1);
  }
  // 대표 용어는 차수, 같으면 정의 길이로 고른다. 관계가 거의 없는 초기 용어집은 차수가 전부 0이라
  // id 순이 되고, 실데이터에서 정의가 빈 "Google"·"Meta"가 AI 도메인 대표로 뽑혀 가설이 근거를 잃었다.
  const hubs = (ids: string[]) => [...ids].sort((x, y) => index.neighbors.get(y)!.size - index.neighbors.get(x)!.size
    || index.byId.get(y)!.definitionChars - index.byId.get(x)!.definitionChars || x.localeCompare(y)).slice(0, 2);
  const domains = [...members.keys()].filter((domain) => members.get(domain)!.length >= minTerms).sort();
  const signals: DiscoverySignal[] = [];
  for (let i = 0; i < domains.length; i += 1) {
    for (let j = i + 1; j < domains.length; j += 1) {
      const da = domains[i]!;
      const db = domains[j]!;
      const na = members.get(da)!.length;
      const nb = members.get(db)!.length;
      const links = cross.get(pairKey(da, db)) ?? 0;
      // 도메인 크기에 비해 관계가 드물어야 사일로다. 큰 두 도메인 사이 관계 1개는 거의 단절이다.
      const density = links / Math.sqrt(na * nb);
      if (density >= 0.15) continue;
      signals.push({
        id: `silo:${da}:${db}`,
        kind: "silo",
        termIds: [...hubs(members.get(da)!), ...hubs(members.get(db)!)],
        viaTermIds: [],
        domains: [da, db],
        score: round(Math.sqrt(na * nb) / (1 + links)),
        novelty: round(1 - Math.min(1, density / 0.15)),
        metrics: { termsA: na, termsB: nb, crossRelations: links },
        summary: `${da}(${na}개)·${db}(${nb}개) 도메인 사이의 승인된 관계: ${links ? `${links}개뿐입니다` : "없습니다"}.`,
      });
    }
  }
  return signals;
}

/** 추이 관계 A→B→C가 있는데 A와 C 사이에 아무 관계가 없는 곳. 문서화되지 않은 함의다. */
export function impliedRelations(graph: DiscoveryGraph, transitiveTypes: readonly string[] = DEFAULT_TRANSITIVE, index = indexGraph(graph)): DiscoverySignal[] {
  const transitive = new Set(transitiveTypes);
  const out = new Map<string, DiscoveryEdge[]>();
  for (const edge of graph.edges) {
    if (!transitive.has(edge.type) || edge.source === edge.target) continue;
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge]);
  }
  const signals: DiscoverySignal[] = [];
  const seen = new Set<string>();
  for (const [a, first] of out) {
    for (const ab of first) {
      for (const bc of out.get(ab.target) ?? []) {
        const c = bc.target;
        if (bc.type !== ab.type || c === a || index.neighbors.get(a)?.has(c)) continue;
        const key = `${a}:${ab.type}:${c}`;
        if (seen.has(key) || !index.byId.has(c)) continue;
        seen.add(key);
        const confidence = Math.min(ab.confidence, bc.confidence);
        signals.push({
          id: `implied:${a}:${ab.target}:${c}`,
          kind: "implied",
          termIds: [a, ab.target, c],
          viaTermIds: [ab.target],
          domains: [...new Set([a, ab.target, c].flatMap((id) => index.byId.get(id)?.domains ?? []))],
          score: round(confidence / 100),
          novelty: 0.3,
          metrics: { confidence },
          relationType: ab.type,
          summary: `${nameOf(index, a)} → ${nameOf(index, ab.target)} → ${nameOf(index, c)} (모두 ${ab.type}): ${nameOf(index, a)}–${nameOf(index, c)} 관계가 함의되지만 기록되어 있지 않습니다.`,
        });
      }
    }
  }
  return signals;
}

/** 많은 지식이 기대는데 정의가 비었거나 얕은 용어. 여기 기대는 추론은 전부 흔들린다. */
export function knowledgeDebt(graph: DiscoveryGraph, index = indexGraph(graph)): DiscoverySignal[] {
  const signals: DiscoverySignal[] = [];
  for (const node of graph.nodes) {
    const degree = index.neighbors.get(node.id)!.size;
    const pages = index.pageCount.get(node.id) ?? 0;
    const reliance = degree + pages;
    const thinness = 1 - Math.min(1, node.definitionChars / 120);
    if (reliance < 3 || (thinness === 0 && node.status === "active")) continue;
    const debt = Math.max(thinness, node.status === "draft" ? 0.5 : 0);
    signals.push({
      id: `knowledge_debt:${node.id}`,
      kind: "knowledge_debt",
      termIds: [node.id],
      viaTermIds: [],
      domains: [...node.domains],
      score: round(reliance * debt),
      novelty: 0.2,
      metrics: { degree, wikiPages: pages, definitionChars: node.definitionChars },
      summary: `${node.name}: 관계 ${degree}개·공개 위키 ${pages}건이 기대는데 정의가 ${node.definitionChars ? `${node.definitionChars}자뿐입니다` : "비어 있습니다"}${node.status === "draft" ? " (정리 미완료)" : ""}.`,
    });
  }
  return signals;
}

export interface DiscoverySignalSet {
  signals: DiscoverySignal[];
  stats: { terms: number; relations: number; wikiPages: number; similarities: number; domains: number; candidates: Record<DiscoverySignalKind, number> };
}

/**
 * kind마다 점수 상위만 남긴다. kind 간 점수는 단위가 달라 한 줄로 정렬하면 쌍이 많은
 * latent_link가 전부를 차지하고 사일로·다리 같은 희소하지만 중요한 신호가 사라진다.
 */
export function computeDiscoverySignals(graph: DiscoveryGraph, options: DiscoveryOptions = {}): DiscoverySignalSet {
  const index = indexGraph(graph);
  const limit = Math.max(1, Math.min(100, options.limitPerKind ?? 12));
  const focus = options.focusTermIds?.length ? new Set(options.focusTermIds) : null;
  const all: Record<DiscoverySignalKind, DiscoverySignal[]> = {
    latent_link: latentLinks(graph, index),
    bridge: bridgeTerms(graph, index),
    silo: domainSilos(graph, index),
    implied: impliedRelations(graph, options.transitiveTypes ?? DEFAULT_TRANSITIVE, index),
    knowledge_debt: knowledgeDebt(graph, index),
  };
  const signals: DiscoverySignal[] = [];
  const candidates = {} as Record<DiscoverySignalKind, number>;
  for (const kind of DISCOVERY_SIGNAL_KINDS) {
    const scoped = focus ? all[kind].filter((signal) => signal.termIds.some((id) => focus.has(id)) || signal.viaTermIds.some((id) => focus.has(id))) : all[kind];
    candidates[kind] = scoped.length;
    signals.push(...scoped.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, limit));
  }
  return {
    signals,
    stats: {
      terms: graph.nodes.length,
      relations: graph.edges.length,
      wikiPages: graph.pages.length,
      similarities: graph.similarities?.length ?? 0,
      domains: new Set(graph.nodes.flatMap((node) => node.domains)).size,
      candidates,
    },
  };
}
