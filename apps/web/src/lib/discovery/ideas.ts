import { z } from "zod/v3";
import type { DiscoverySignal, DiscoverySignalKind } from "./signals";

/**
 * 발굴 에이전트의 생성·비평 결과를 검증하고 순위를 매기는 순수 함수와 화면 공용 타입.
 * 서버 전용 모듈과 분리해 클라이언트 컴포넌트와 테스트가 함께 쓴다.
 */

export interface DiscoveryTermCard {
  /** 프롬프트와 화면에서 쓰는 짧은 근거 id(T1, T2…). 모델이 uuid를 베끼다 틀리는 일을 막는다. */
  ref: string;
  termId: string;
  slug: string;
  name: string;
  domains: string[];
  revision: number;
  definition: string;
}

export interface DiscoverySignalCard {
  ref: string;
  kind: DiscoverySignalKind;
  summary: string;
  termRefs: string[];
  viaRefs: string[];
  novelty: number;
  score: number;
}

export interface DiscoveryReasoningStep {
  text: string;
  evidenceRefs: string[];
}

export interface DiscoveryCritique {
  novelty: number;
  grounding: number;
  feasibility: number;
  impact: number;
  verdict: "keep" | "revise" | "drop";
  comment: string;
}

export interface DiscoveryCitation {
  id: string;
  title: string;
  excerpt: string;
  slug?: string;
  wikiSlug?: string;
  revision?: number;
}

/** 가설의 가장 약한 고리를 용어집 전체(정의·본문·공개 위키)에서 다시 찾아 본 결과. */
export interface DiscoveryVerification {
  query: string;
  verdict: "supported" | "contradicted" | "insufficient";
  note: string;
  citations: DiscoveryCitation[];
}

export interface DiscoveryIdea {
  title: string;
  hypothesis: string;
  reasoning: DiscoveryReasoningStep[];
  whyNovel: string;
  signalRefs: string[];
  termRefs: string[];
  firstExperiment: string;
  successMetric: string;
  risks: string[];
  openQuestions: string[];
  critique?: DiscoveryCritique;
  verification?: DiscoveryVerification;
  /** 인용한 용어끼리 이미 관계나 위키로 이어져 있으면 true. 사람이 아는 연결의 재진술일 가능성이 높다. */
  alreadyConnected: boolean;
  score: number;
}

export interface DiscoveryReport {
  focus: string | null;
  domain: string | null;
  ideas: DiscoveryIdea[];
  /** 비평에서 탈락한 가설 수. 숨기면 모델이 처음부터 몇 개만 냈다고 오해한다. */
  dropped: number;
  signals: DiscoverySignalCard[];
  terms: DiscoveryTermCard[];
  stats: {
    terms: number;
    relations: number;
    wikiPages: number;
    similarities: number;
    domains: number;
    truncated: boolean;
  };
}

const refs = z.array(z.unknown()).default([]).transform((items) => items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 12));
const text = (max: number) => z.string().trim().min(1).transform((value) => value.slice(0, max));
const optionalText = (max: number) => z.string().default("").transform((value) => value.trim().slice(0, max));
const list = (max: number, length: number) => z.array(z.unknown()).default([]).transform((items) => items.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, length)).filter(Boolean).slice(0, max));

// 길이 초과는 거부하지 않고 자른다. 장황한 모델 하나 때문에 가설 전체가 버려지지 않게 한다(research.ts와 같은 이유).
const ideaSchema = z.object({
  title: text(160),
  hypothesis: text(1_200),
  reasoning: z.array(z.object({ text: text(600), evidenceRefs: refs }).passthrough()).default([]).transform((steps) => steps.slice(0, 6)),
  whyNovel: optionalText(800),
  signalRefs: refs,
  termRefs: refs,
  firstExperiment: optionalText(800),
  successMetric: optionalText(400),
  risks: list(5, 300),
  openQuestions: list(5, 300),
}).passthrough();

const generationSchema = z.object({ ideas: z.array(z.unknown()).default([]) }).passthrough();

const score = z.coerce.number().transform((value) => Math.max(1, Math.min(5, Math.round(value))));
const critiqueSchema = z.object({
  reviews: z.array(z.object({
    index: z.coerce.number().int(),
    novelty: score,
    grounding: score,
    feasibility: score,
    impact: score,
    verdict: z.enum(["keep", "revise", "drop"]).catch("revise"),
    comment: optionalText(600),
  }).passthrough()).default([]),
}).passthrough();

/**
 * 모델이 낸 가설에서 근거 id를 검증한다. 없는 id는 지우고, 지운 뒤 근거가 하나도 없는 추론
 * 단계와 용어를 둘 이상 인용하지 않는 가설은 버린다. 용어 하나로는 "결합"이 아니어서
 * 일반 지식으로 쓴 문장일 가능성이 높다.
 */
export function validateIdeas(raw: unknown, allowedTerms: ReadonlySet<string>, allowedSignals: ReadonlySet<string>): Array<Omit<DiscoveryIdea, "alreadyConnected" | "score">> {
  const parsed = generationSchema.safeParse(raw);
  if (!parsed.success) return [];
  const allowed = (ref: string) => allowedTerms.has(ref) || allowedSignals.has(ref);
  const ideas: Array<Omit<DiscoveryIdea, "alreadyConnected" | "score">> = [];
  const seenTitles = new Set<string>();
  for (const item of parsed.data.ideas) {
    const idea = ideaSchema.safeParse(item);
    if (!idea.success) continue;
    const reasoning = idea.data.reasoning
      .map((step) => ({ text: step.text, evidenceRefs: [...new Set(step.evidenceRefs.filter(allowed))] }))
      .filter((step) => step.evidenceRefs.length > 0);
    const cited = new Set([...idea.data.termRefs, ...reasoning.flatMap((step) => step.evidenceRefs)].filter((ref) => allowedTerms.has(ref)));
    if (cited.size < 2 || reasoning.length === 0) continue;
    const titleKey = idea.data.title.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    ideas.push({
      title: idea.data.title,
      hypothesis: idea.data.hypothesis,
      reasoning,
      whyNovel: idea.data.whyNovel,
      signalRefs: [...new Set(idea.data.signalRefs.filter((ref) => allowedSignals.has(ref)))],
      termRefs: [...cited],
      firstExperiment: idea.data.firstExperiment,
      successMetric: idea.data.successMetric,
      risks: idea.data.risks,
      openQuestions: idea.data.openQuestions,
    });
  }
  return ideas;
}

export function parseCritiques(raw: unknown, count: number): Map<number, DiscoveryCritique> {
  const parsed = critiqueSchema.safeParse(raw);
  const result = new Map<number, DiscoveryCritique>();
  if (!parsed.success) return result;
  for (const review of parsed.data.reviews) {
    if (review.index < 0 || review.index >= count || result.has(review.index)) continue;
    result.set(review.index, {
      novelty: review.novelty,
      grounding: review.grounding,
      feasibility: review.feasibility,
      impact: review.impact,
      verdict: review.verdict,
      comment: review.comment,
    });
  }
  return result;
}

const verificationSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "insufficient"]).catch("insufficient"),
  note: optionalText(600),
  evidenceIds: refs,
}).passthrough();

/**
 * 검증 판정을 읽는다. 근거 id 없이 supported·contradicted라고 하면 insufficient로 낮춘다 —
 * 근거 없는 "확인됨"은 가설을 사실처럼 보이게 만드는, 이 단계가 막으려는 바로 그 출력이다.
 */
export function parseVerification(raw: unknown, query: string, evidence: readonly DiscoveryCitation[]): DiscoveryVerification {
  const parsed = verificationSchema.safeParse(raw);
  if (!parsed.success) return { query, verdict: "insufficient", note: "검증 응답을 해석하지 못했습니다.", citations: [] };
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const citations = [...new Set(parsed.data.evidenceIds)].map((id) => byId.get(id)).filter((item): item is DiscoveryCitation => Boolean(item)).slice(0, 4);
  const verdict = citations.length ? parsed.data.verdict : "insufficient";
  return { query, verdict, note: parsed.data.note, citations };
}

/** 용어집이 반박한 가설은 크게, 뒷받침한 가설은 조금 올린다. 근거 부족은 그대로 둔다 — 빈 용어집에서 흔한 상태다. */
export function verificationFactor(verification: DiscoveryVerification | undefined): number {
  if (!verification) return 1;
  return verification.verdict === "contradicted" ? 0.5 : verification.verdict === "supported" ? 1.1 : 1;
}

/**
 * 인용 용어가 모두 이미 서로 이어져 있는지(직접 관계 또는 같은 공개 위키)를 그래프로 판정한다.
 * 비평 모델은 조직이 무엇을 이미 아는지 모르므로 새로움을 과대평가한다. 이 판정은 규칙으로 한다.
 */
export function isAlreadyConnected(termIds: readonly string[], connected: (a: string, b: string) => boolean): boolean {
  const ids = [...new Set(termIds)];
  if (ids.length < 2) return false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) if (!connected(ids[i]!, ids[j]!)) return false;
  }
  return true;
}

/**
 * 근거성을 가장 무겁게 둔다. 새롭기만 하고 근거가 없는 가설은 이 제품에서 가장 해로운 출력이다 —
 * 조직 용어집이 뒷받침하는 것처럼 보이는 지어낸 전략이 되기 때문이다. 비평이 없으면(호출 실패)
 * 중립값 3으로 두고 순위는 구조 신호의 새로움으로만 가른다.
 */
export function rankIdea(critique: DiscoveryCritique | undefined, signalNovelty: number, alreadyConnected: boolean): number {
  const c = critique ?? { novelty: 3, grounding: 3, feasibility: 3, impact: 3, verdict: "revise" as const, comment: "" };
  const base = 0.35 * c.grounding + 0.25 * c.novelty + 0.2 * c.impact + 0.2 * c.feasibility;
  const structural = 0.5 + 0.5 * Math.max(0, Math.min(1, signalNovelty));
  const penalty = alreadyConnected ? 0.7 : 1;
  const verdict = c.verdict === "keep" ? 1 : c.verdict === "revise" ? 0.85 : 0;
  return Math.round(base * structural * penalty * verdict * 1000) / 1000;
}

/** 탐색 질문에서 "새로운 도전" 의도를 찾는다. 일반 질문을 발굴로 보내면 수십 초짜리 분석이 엉뚱하게 돈다. */
export function looksLikeDiscoveryRequest(textValue: string): boolean {
  const value = textValue.normalize("NFKC");
  if (/새로운?\s*(?:도전|기회|과제|아이디어|가설|연구\s*주제|사업\s*기회)|아무도\s*(?:시도|생각)|숨은?\s*(?:연결|기회|관계)|미개척|발굴해|(?:도전|기회|과제)\s*(?:를|을)?\s*(?:찾아|발굴|제안)|blind\s*spot|unexplored|new\s+(?:challenge|opportunit|idea|hypothes)/i.test(value)) return true;
  return /(?:용어집|지식|그래프|온톨로지).{0,20}(?:기반|바탕|활용).{0,30}(?:도전|기회|가설|혁신|아이디어|과제)/.test(value);
}

export function signalLabel(kind: DiscoverySignalKind): string {
  return {
    latent_link: "숨은 연결",
    bridge: "다리 용어",
    silo: "도메인 사일로",
    implied: "함의된 관계",
    knowledge_debt: "지식 부채",
  }[kind];
}

/** 화면이 없는 호출자(API 키·외부 에이전트·저장된 대화)를 위한 마크다운 요약. */
export function discoveryMarkdown(report: Pick<DiscoveryReport, "ideas" | "terms" | "dropped" | "stats" | "focus">): string {
  const terms = new Map(report.terms.map((term) => [term.ref, term]));
  const cite = (refs: readonly string[]) => refs.map((ref) => terms.get(ref)).filter(Boolean).map((term) => `[${term!.name}](/g/${term!.slug})`).join(", ");
  if (!report.ideas.length) {
    return `용어 ${report.stats.terms}개·관계 ${report.stats.relations}개를 분석했지만 근거로 뒷받침되는 새 도전 가설을 만들지 못했습니다.${report.dropped ? ` 비평 단계에서 ${report.dropped}개를 근거 부족으로 제외했습니다.` : ""} 용어의 정의와 관계를 더 채우면 발굴 품질이 올라갑니다.`;
  }
  const lines = [`용어 ${report.stats.terms}개·관계 ${report.stats.relations}개·공개 위키 ${report.stats.wikiPages}건의 구조에서 아직 이어지지 않은 곳을 찾아 ${report.ideas.length}개의 도전 가설을 만들었습니다.${report.focus ? ` 주제: ${report.focus}` : ""}`, ""];
  report.ideas.forEach((idea, index) => {
    lines.push(`### ${index + 1}. ${idea.title}`, "", idea.hypothesis, "");
    if (idea.termRefs.length) lines.push(`- 근거 용어: ${cite(idea.termRefs)}`);
    if (idea.whyNovel) lines.push(`- 새로운 이유: ${idea.whyNovel}`);
    if (idea.firstExperiment) lines.push(`- 첫 실험: ${idea.firstExperiment}`);
    if (idea.successMetric) lines.push(`- 성공 지표: ${idea.successMetric}`);
    if (idea.verification) lines.push(`- 용어집 검증(${idea.verification.query}): ${{ supported: "뒷받침됨", contradicted: "반박됨", insufficient: "근거 부족" }[idea.verification.verdict]}${idea.verification.note ? ` — ${idea.verification.note}` : ""}`);
    if (idea.alreadyConnected) lines.push("- 주의: 인용 용어가 이미 관계·위키로 이어져 있어 기존 지식의 재진술일 수 있습니다.");
    lines.push("");
  });
  lines.push("가설은 용어집 구조와 정의에서 추론한 것이며 검증된 사실이 아닙니다. 첫 실험으로 확인하세요.");
  return lines.join("\n");
}

export type { DiscoverySignal };

export interface DiscoveryWikiDraft {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  termSlugs: string[];
  status: "draft";
}

const VERDICT_TEXT = { supported: "뒷받침됨", contradicted: "반박됨", insufficient: "근거 부족" } as const;

/**
 * 가설을 위키 초안으로 바꾼다. 가설은 용어 정의가 아니라 검증할 과제이므로 용어가 아닌 위키에 두고,
 * "실험 결과" 칸을 비워 두어 사람이 결과를 이어 적게 한다. 그 결과가 공개되면 다음 발굴의 근거가 된다.
 */
export function ideaWikiDraft(idea: DiscoveryIdea, report: Pick<DiscoveryReport, "terms" | "signals">, generatedAt = new Date()): DiscoveryWikiDraft {
  const terms = new Map(report.terms.map((term) => [term.ref, term]));
  const signals = new Map(report.signals.map((signal) => [signal.ref, signal]));
  // 본문 속 T·S id는 이 초안 밖에서는 뜻이 없다. 용어 이름과 신호 문장으로 바꿔 쓴다.
  const expand = (text: string) => text.replace(/\b([TS]\d+)\b/g, (ref) => terms.get(ref)?.name ?? (signals.has(ref) ? `[${ref}]` : ref));
  const cite = (refs: readonly string[]) => refs.map((ref) => terms.get(ref) ? `[${terms.get(ref)!.name}](/g/${terms.get(ref)!.slug})` : signals.has(ref) ? `[${ref}]` : null).filter(Boolean).join(", ");
  const lines = [
    `> 발굴 에이전트가 ${generatedAt.toISOString().slice(0, 10)}에 용어집 구조와 정의에서 추론한 **검증 전 가설**입니다. 사실로 인용하지 마세요.`,
    "",
    "## 가설",
    "",
    expand(idea.hypothesis),
    "",
    "## 추론",
    "",
    ...idea.reasoning.map((step, index) => `${index + 1}. ${expand(step.text)}${step.evidenceRefs.length ? ` — ${cite(step.evidenceRefs)}` : ""}`),
    "",
  ];
  if (idea.whyNovel) lines.push("## 아직 시도되지 않은 이유", "", expand(idea.whyNovel), "");
  if (idea.critique) lines.push("## 비평", "", `근거 ${idea.critique.grounding} · 새로움 ${idea.critique.novelty} · 실현성 ${idea.critique.feasibility} · 영향 ${idea.critique.impact} / 5`, "", expand(idea.critique.comment), "");
  if (idea.verification) {
    lines.push("## 용어집 검증", "", `- 확인한 고리: ${expand(idea.verification.query)}`, `- 판정: **${VERDICT_TEXT[idea.verification.verdict]}**${idea.verification.note ? ` — ${idea.verification.note}` : ""}`);
    for (const citation of idea.verification.citations) lines.push(`- ${citation.wikiSlug ? `[${citation.title}](/w/${citation.wikiSlug})` : citation.slug ? `[${citation.title}](/g/${citation.slug})` : citation.title}: ${citation.excerpt.slice(0, 200)}`);
    lines.push("");
  }
  lines.push("## 첫 실험", "", idea.firstExperiment ? expand(idea.firstExperiment) : "(정하지 않음)", "");
  if (idea.successMetric) lines.push(`성공 지표: ${expand(idea.successMetric)}`, "");
  if (idea.risks.length) lines.push("## 위험", "", ...idea.risks.map((risk) => `- ${expand(risk)}`), "");
  if (idea.openQuestions.length) lines.push("## 전문가에게 물을 질문", "", ...idea.openQuestions.map((question) => `- ${expand(question)}`), "");
  const usedSignals = [...new Set([...idea.signalRefs, ...idea.reasoning.flatMap((step) => step.evidenceRefs)])].map((ref) => signals.get(ref)).filter(Boolean);
  if (usedSignals.length) lines.push("## 근거 신호", "", ...usedSignals.map((signal) => `- [${signal!.ref}] ${signalLabel(signal!.kind)}: ${signal!.summary}`), "");
  lines.push("## 실험 결과", "", "- 담당:", "- 기간:", "- 결과: (가설이 맞았는지, 무엇을 배웠는지)", "");
  return {
    title: `[도전 가설] ${idea.title}`.slice(0, 240),
    summary: expand(idea.hypothesis).slice(0, 600),
    content: lines.join("\n"),
    tags: ["도전 가설", "발굴 에이전트"],
    termSlugs: [...new Set(idea.termRefs.map((ref) => terms.get(ref)?.slug).filter((slug): slug is string => Boolean(slug)))].slice(0, 20),
    status: "draft",
  };
}
