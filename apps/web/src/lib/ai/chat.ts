import "server-only";

import { loadAiConfig, runtimeAiConfig } from "./config";
import type { AiRuntimeConfig } from "./provider";
import { retrieveGlossaryContext, type ChatSource } from "./retrieval";
import { collectTermTeaching, extractPastedGlossary, looksLikeGlossaryPaste } from "./teaching";
import type { TermTeachingBatch, TermTeachingDraft } from "./teaching-values";
import { classifyChatIntent, proposeChatEdit } from "./chat-edit";
import type { ChatEditProposal } from "./chat-edit-values";
import { answerWithEvidence, fitEvidenceBudget } from "./grounded-answer";
import type { GroundedChatAnswer } from "./grounding-values";
import type { AiRunContext } from "./observability-values";
import { analyzeMeeting, looksLikeMeetingRequest } from "./meeting";
import type { MeetingAnalysis } from "./meeting-values";
import { ChatAbortedError, createChatTracer, type ChatRunHooks, type ChatTracer } from "./chat-trace";
import type { ChatTraceStep } from "./chat-trace-values";
import { researchGlossary } from "./research";
import { discoverChallenges } from "./discovery";
import { looksLikeDiscoveryRequest, type DiscoveryReport } from "@/lib/discovery/ideas";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GlossaryChatResult {
  answer: string;
  sources: ChatSource[];
  teaching?: { draft: TermTeachingDraft; ready: boolean };
  teachingBatch?: TermTeachingBatch;
  edit?: ChatEditProposal;
  grounded?: GroundedChatAnswer;
  meeting?: MeetingAnalysis;
  discovery?: DiscoveryReport;
  trace?: ChatTraceStep[];
}

export async function answerGlossaryQuestion(
  question: string,
  history: ChatHistoryMessage[] = [],
  teachingDraft: TermTeachingDraft | null = null,
  previousEdit: ChatEditProposal | null = null,
  domain?: string,
  telemetry?: AiRunContext,
  hooks: ChatRunHooks = {},
): Promise<GlossaryChatResult> {
  const row = await loadAiConfig();
  if (!row.enabled) throw new Error("AI_NOT_ENABLED");
  const config = runtimeAiConfig(row);
  const tracer = createChatTracer(hooks);
  const context: AiRunContext | undefined = hooks.signal ? { ...telemetry, signal: hooks.signal } : telemetry;
  try {
    const result = await runChat(config, tracer, question, history, teachingDraft, previousEdit, domain, context);
    // 마지막 호출이 끝난 직후에 끊겼을 수 있다. 그대로 돌려주면 서버는 사용자가 보지 못한 답을 저장하고,
    // 화면의 "중단" 표시와 다시 열었을 때의 대화가 어긋난다.
    tracer.checkAborted();
    tracer.close();
    return { ...result, trace: tracer.steps };
  } catch (caught) {
    // AI 호출이 중단되면 AbortError가 올라온다. 라우트는 ChatAbortedError만 499로 처리한다.
    const error = hooks.signal?.aborted && !(caught instanceof ChatAbortedError) ? new ChatAbortedError() : caught;
    tracer.close("failed");
    if (error instanceof Error) Object.assign(error, { trace: tracer.steps });
    throw error;
  }
}

async function runChat(
  config: AiRuntimeConfig,
  tracer: ChatTracer,
  question: string,
  history: ChatHistoryMessage[],
  teachingDraft: TermTeachingDraft | null,
  previousEdit: ChatEditProposal | null,
  domain: string | undefined,
  telemetry: AiRunContext | undefined,
): Promise<GlossaryChatResult> {
  const step = (message: string) => {
    tracer.checkAborted();
    tracer.task(message);
  };

  step("요청 유형과 대화 맥락 파악");
  const classified = await classifyChatIntent(config, question, history, previousEdit, teachingDraft, telemetry);
  if (!classified.success) return { answer: "요청을 해석하지 못했습니다. 질문 또는 수정할 용어와 내용을 다시 알려주세요.", sources: [] };
  const intent = classified.data.intent === "ask" && looksLikeMeetingRequest(question) ? "meeting" : classified.data.intent;
  if (intent === "unsupported") return { answer: "현재 챗에서는 용어 생성과 정의·표기·분류 수정을 지원합니다. 관계 제안은 [정리 대기의 AI 검토](/contribute?tab=agent)에서 확인할 수 있습니다. 관계 변경·삭제·병합 실행은 현재 챗에서 지원하지 않습니다.", sources: [] };

  if (intent === "ask" && looksLikeDiscoveryRequest(question)) {
    const { answer, ...discovery } = await discoverChallenges(config, { focus: question, domain }, tracer, telemetry);
    return { answer, sources: [], discovery };
  }

  if (intent === "meeting") {
    step("회의 내용의 결정사항·실행 항목 분석");
    const result = await analyzeMeeting(config, question, history, domain, telemetry);
    return {
      answer: result.answer,
      sources: result.sources,
      ...(result.analysis ? { meeting: result.analysis } : {}),
    };
  }

  if (intent === "edit") {
    step("수정할 용어와 현재 내용 조회");
    const grounding = await retrieveGlossaryContext(classified.data.query, 12, { domain, passageQuery: question, vectorSearch: true, includeMeetingDocuments: false, includeWikiDocuments: true, telemetry });
    step("요청한 변경을 반영한 수정안 작성");
    const result = await proposeChatEdit(config, question, history, grounding, previousEdit, telemetry);
    return { ...result, sources: grounding.sources };
  }

  if (teachingDraft && intent === "create") {
    step("용어 등록 정보 정리");
    const teaching = await collectTermTeaching(config, question, history, teachingDraft, telemetry);
    return {
      answer: teaching.answer,
      sources: [],
      ...(teaching.draft ? { teaching: { draft: teaching.draft, ready: teaching.ready } } : {}),
    };
  }

  if (intent === "create" && looksLikeGlossaryPaste(question)) {
    step("붙여넣은 용어 목록에서 항목 추출");
    const pasted = await extractPastedGlossary(config, question, telemetry);
    return {
      answer: pasted.answer,
      sources: [],
      ...(pasted.batch ? { teachingBatch: pasted.batch } : {}),
    };
  }

  if (intent === "create") {
    step("용어 등록 정보 정리");
    const teaching = await collectTermTeaching(config, question, history, null, telemetry);
    return { answer: teaching.answer, sources: [], ...(teaching.draft ? { teaching: { draft: teaching.draft, ready: teaching.ready } } : {}) };
  }

  const { grounding, queries } = await researchGlossary(config, question, history, classified.data.query, { domain, vectorSearch: true, includeWikiDocuments: true, telemetry }, tracer, telemetry);
  if (grounding.sources.length === 0 && !(grounding.evidence?.length)) {
    const answer = `관련 근거를 찾지 못했습니다. ${queries.length}개 검색어(${queries.map((query) => `“${query}”`).join(", ")})로 찾았지만 일치하는 용어·위키·회의록이 없었습니다. 미등록 용어인지, 다른 표기로 등록되어 있는지는 아직 확인되지 않았습니다. 용어의 다른 이름이나 도메인을 알려주세요. 새 용어라면 ‘등록해줘’라고 요청할 수 있습니다.`;
    return {
      answer,
      sources: [],
      grounded: { claims: [], insights: [], uncertainties: [answer], evidence: [], ontology: [], searchedQueries: queries, domain: domain ?? null },
    };
  }

  tracer.checkAborted();
  // 답변 프롬프트는 글자 예산 안의 근거만 받는다. 찾은 개수를 그대로 쓰면 실제보다 많이 읽은 것처럼 보인다.
  const usable = grounding.evidence?.length ? fitEvidenceBudget(grounding.evidence).length : grounding.sources.length;
  const answerId = tracer.start("answer", `근거 ${usable}개로 답변 작성`);
  const result = await answerWithEvidence(config, question, history, grounding, queries, { domain, vectorSearch: true, telemetry, followUp: false }, telemetry);
  tracer.finish(answerId, { label: result.grounded.evidence.length ? `근거 ${result.grounded.evidence.length}개를 인용해 답변했습니다` : "근거와 연결된 답변을 만들지 못했습니다" });
  return result;
}
