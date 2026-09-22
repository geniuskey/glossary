import "server-only";

import { loadAiConfig, runtimeAiConfig } from "./config";
import { retrieveGlossaryContext, type ChatSource } from "./retrieval";
import { collectTermTeaching, extractPastedGlossary, looksLikeGlossaryPaste } from "./teaching";
import type { TermTeachingBatch, TermTeachingDraft } from "./teaching-values";
import { classifyChatIntent, proposeChatEdit } from "./chat-edit";
import type { ChatEditProposal } from "./chat-edit-values";
import { answerWithEvidence } from "./grounded-answer";
import type { GroundedChatAnswer } from "./grounding-values";
import type { AiRunContext } from "./observability-values";
import { analyzeMeeting, looksLikeMeetingRequest } from "./meeting";
import type { MeetingAnalysis } from "./meeting-values";

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
}

export async function answerGlossaryQuestion(
  question: string,
  history: ChatHistoryMessage[] = [],
  teachingDraft: TermTeachingDraft | null = null,
  previousEdit: ChatEditProposal | null = null,
  domain?: string,
  telemetry?: AiRunContext,
): Promise<GlossaryChatResult> {
  const row = await loadAiConfig();
  if (!row.enabled) throw new Error("AI_NOT_ENABLED");
  const config = runtimeAiConfig(row);

  const classified = await classifyChatIntent(config, question, history, previousEdit, teachingDraft, telemetry);
  if (!classified.success) return { answer: "요청을 해석하지 못했습니다. 질문 또는 수정할 용어와 내용을 다시 알려주세요.", sources: [] };
  const intent = classified.data.intent === "ask" && looksLikeMeetingRequest(question) ? "meeting" : classified.data.intent;
  if (intent === "unsupported") return { answer: "현재 챗에서는 용어 생성과 정의·표기·분류 수정을 지원합니다. 관계 제안은 [정리 대기의 AI 검토](/contribute?tab=agent)에서 확인할 수 있습니다. 관계 변경·삭제·병합 실행은 현재 챗에서 지원하지 않습니다.", sources: [] };

  if (intent === "meeting") {
    const result = await analyzeMeeting(config, question, history, domain, telemetry);
    return {
      answer: result.answer,
      sources: result.sources,
      ...(result.analysis ? { meeting: result.analysis } : {}),
    };
  }

  if (intent === "edit") {
    const grounding = await retrieveGlossaryContext(classified.data.query, 12, { domain, passageQuery: question, vectorSearch: true, includeMeetingDocuments: false, includeWikiDocuments: true, telemetry });
    const result = await proposeChatEdit(config, question, history, grounding, previousEdit, telemetry);
    return { ...result, sources: grounding.sources };
  }

  if (teachingDraft && intent === "create") {
    const teaching = await collectTermTeaching(config, question, history, teachingDraft, telemetry);
    return {
      answer: teaching.answer,
      sources: [],
      ...(teaching.draft ? { teaching: { draft: teaching.draft, ready: teaching.ready } } : {}),
    };
  }

  if (intent === "create" && looksLikeGlossaryPaste(question)) {
    const pasted = await extractPastedGlossary(config, question, telemetry);
    return {
      answer: pasted.answer,
      sources: [],
      ...(pasted.batch ? { teachingBatch: pasted.batch } : {}),
    };
  }

  if (intent === "create") {
    const teaching = await collectTermTeaching(config, question, history, null, telemetry);
    return { answer: teaching.answer, sources: [], ...(teaching.draft ? { teaching: { draft: teaching.draft, ready: teaching.ready } } : {}) };
  }

  const retrievalQuestion = classified.data.query;
  const queries = [retrievalQuestion];
  let grounding = await retrieveGlossaryContext(retrievalQuestion, 12, { domain, passageQuery: question, vectorSearch: true, includeWikiDocuments: true, telemetry });
  if (!grounding.sources.length && retrievalQuestion !== question) {
    grounding = await retrieveGlossaryContext(question, 12, { domain, passageQuery: question, vectorSearch: true, includeWikiDocuments: true, telemetry });
    queries.push(question);
  }
  if (grounding.sources.length === 0 && !(grounding.evidence?.length)) {
    const answer = "관련 근거를 찾지 못했습니다. 미등록 용어인지, 다른 표기로 등록되어 있는지는 아직 확인되지 않았습니다. 용어의 다른 이름이나 도메인을 알려주세요. 새 용어라면 ‘등록해줘’라고 요청할 수 있습니다.";
    return {
      answer,
      sources: [],
      grounded: { claims: [], insights: [], uncertainties: [answer], evidence: [], ontology: [], searchedQueries: queries, domain: domain ?? null },
    };
  }

  return answerWithEvidence(config, question, history, grounding, queries, { domain, vectorSearch: true, telemetry }, telemetry);
}
