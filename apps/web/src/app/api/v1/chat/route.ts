import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { chatConversations } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getCurrentUser } from "@/lib/auth/current-user";
import { answerGlossaryQuestion } from "@/lib/ai/chat";
import { AiProviderError } from "@/lib/ai/provider";
import type { ChatHistoryResponse, StoredChatMessage } from "@/lib/ai/chat-history-values";
import type { TermTeachingDraft } from "@/lib/ai/teaching-values";
import { getDb } from "@/lib/db";

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE"];
const { PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, OPTIONS };

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
});
const nullableDraftText = (max: number) => z.string().trim().min(1).max(max).nullable();
const teachingDraftSchema: z.ZodType<TermTeachingDraft> = z.object({
  nameEn: nullableDraftText(160),
  nameKo: nullableDraftText(160),
  fullNameEn: nullableDraftText(160),
  fullNameKo: nullableDraftText(160),
  definitionMd: nullableDraftText(2_000),
  bodyMd: nullableDraftText(8_000),
  skipped: z.object({ fullName: z.boolean(), definition: z.boolean(), body: z.boolean() }).strict(),
}).strict().refine((draft) => Boolean(draft.nameEn || draft.nameKo), { message: "초안에는 용어 표기가 필요합니다." });
const requestSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  history: z.array(messageSchema).max(8).default([]),
  teachingDraft: teachingDraftSchema.nullable().optional(),
  sessionId: z.string().uuid().optional(),
}).strict().refine((value) => value.question.length + value.history.reduce((sum, item) => sum + item.content.length, 0) <= 28_000, {
  message: "대화와 붙여넣기 내용은 합계 28,000자까지 보낼 수 있습니다.",
});

const storedMessageSchema = z.object({
  id: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(20_000),
}).passthrough();
const replaceMessagesSchema = z.object({
  sessionId: z.string().uuid(),
  messages: z.array(storedMessageSchema).max(500),
}).strict().refine((value) => JSON.stringify(value.messages).length <= 1_000_000, {
  message: "대화 기록은 1MB까지 저장할 수 있습니다.",
});

function storedMessages(value: unknown): StoredChatMessage[] {
  return Array.isArray(value) ? value as StoredChatMessage[] : [];
}

function nextMessageId(messages: StoredChatMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;
}

function titleFromQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, 80);
}

export const GET = withApiErrors(async (request: Request) => {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);

  const selectedId = new URL(request.url).searchParams.get("session");
  if (selectedId && !z.string().uuid().safeParse(selectedId).success) {
    return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
  }

  const rows = await getDb().select({
    id: chatConversations.id,
    title: chatConversations.title,
    createdAt: chatConversations.createdAt,
    updatedAt: chatConversations.updatedAt,
    messageCount: sql<number>`jsonb_array_length(${chatConversations.messages})::int`,
  }).from(chatConversations)
    .where(eq(chatConversations.userId, user.id))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(50);

  let conversation: ChatHistoryResponse["conversation"] = null;
  if (selectedId) {
    const [row] = await getDb().select().from(chatConversations).where(and(
      eq(chatConversations.id, selectedId),
      eq(chatConversations.userId, user.id),
    )).limit(1);
    if (!row) return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
    conversation = {
      id: row.id,
      title: row.title,
      messages: storedMessages(row.messages),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  const body: ChatHistoryResponse = {
    sessions: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    conversation,
  };
  return Response.json(body);
});

const rateLimits = new Map<string, { count: number; resetAt: number }>();
function allowRequest(key: string): boolean {
  const now = Date.now();
  if (rateLimits.size > 10_000) {
    for (const [entryKey, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(entryKey);
    }
  }
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const key = auth.kind === "user" ? `user:${auth.user.id}` : `key:${auth.keyId}`;
  if (!allowRequest(key)) return apiError("rate_limited", "잠시 후 다시 질문해 주세요.", 429);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "질문과 대화 내용을 확인해 주세요.", 400, parsed.error.flatten());

  let conversationId: string | undefined;
  let previousMessages: StoredChatMessage[] = [];
  if (auth.kind === "user") {
    if (parsed.data.sessionId) {
      const [row] = await getDb().select().from(chatConversations).where(and(
        eq(chatConversations.id, parsed.data.sessionId),
        eq(chatConversations.userId, auth.user.id),
      )).limit(1);
      if (!row) return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
      conversationId = row.id;
      previousMessages = storedMessages(row.messages);
    } else {
      const [row] = await getDb().insert(chatConversations).values({
        userId: auth.user.id,
        title: titleFromQuestion(parsed.data.question),
      }).returning({ id: chatConversations.id });
      conversationId = row!.id;
    }

    const userMessage: StoredChatMessage = {
      id: nextMessageId(previousMessages),
      role: "user",
      content: parsed.data.question,
    };
    previousMessages = [...previousMessages, userMessage];
    await getDb().update(chatConversations).set({ messages: previousMessages, updatedAt: new Date() }).where(and(
      eq(chatConversations.id, conversationId),
      eq(chatConversations.userId, auth.user.id),
    ));
  }

  try {
    const history = auth.kind === "user"
      ? previousMessages.slice(0, -1).slice(-8).map(({ role, content }) => ({ role, content: content.slice(-4_000) }))
      : parsed.data.history;
    const result = await answerGlossaryQuestion(parsed.data.question, history, parsed.data.teachingDraft ?? null);
    if (auth.kind === "user" && conversationId) {
      const assistantMessage: StoredChatMessage = {
        id: nextMessageId(previousMessages),
        role: "assistant",
        content: result.answer,
        sources: result.sources,
        teaching: result.teaching,
        teachingBatch: result.teachingBatch,
      };
      previousMessages = [...previousMessages, assistantMessage];
      await getDb().update(chatConversations).set({ messages: previousMessages, updatedAt: new Date() }).where(and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.userId, auth.user.id),
      ));
    }
    return Response.json({ ...result, ...(conversationId ? { sessionId: conversationId } : {}) });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "관리자가 용어 챗봇 연결을 활성화하지 않았습니다.", 503, conversationId ? { sessionId: conversationId } : undefined);
    }
    if (error instanceof AiProviderError) {
      const message = error.status === 404
        ? "설정된 AI 모델을 사용할 수 없습니다. 관리자에게 다른 모델을 선택해 달라고 요청하세요."
        : error.status === 401 || error.status === 403
          ? "AI API 인증에 실패했습니다. 관리자에게 API Key와 접근 권한을 확인해 달라고 요청하세요."
          : error.status === 429
            ? "AI API의 요청 한도 또는 할당량을 초과했습니다. 잠시 후 다시 시도하거나 관리자에게 확인해 주세요."
            : "AI 응답을 받지 못했습니다. 관리자에게 연결 상태를 확인해 달라고 요청하세요.";
      return apiError("ai_provider_error", message, 502, conversationId ? { sessionId: conversationId } : undefined);
    }
    throw error;
  }
});

export const PATCH = withApiErrors(async (request: Request) => {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);
  const parsed = replaceMessagesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "저장할 대화 기록을 확인해 주세요.", 400, parsed.error.flatten());

  const [updated] = await getDb().update(chatConversations).set({
    messages: parsed.data.messages as StoredChatMessage[],
    updatedAt: new Date(),
  }).where(and(
    eq(chatConversations.id, parsed.data.sessionId),
    eq(chatConversations.userId, user.id),
  )).returning({ id: chatConversations.id });
  if (!updated) return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
  return Response.json({ ok: true });
});

export const DELETE = withApiErrors(async (request: Request) => {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);
  const sessionId = new URL(request.url).searchParams.get("session");
  if (!sessionId || !z.string().uuid().safeParse(sessionId).success) {
    return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
  }
  const [deleted] = await getDb().delete(chatConversations).where(and(
    eq(chatConversations.id, sessionId),
    eq(chatConversations.userId, user.id),
  )).returning({ id: chatConversations.id });
  if (!deleted) return apiError("not_found", "대화 세션을 찾을 수 없습니다.", 404);
  return new Response(null, { status: 204 });
});
