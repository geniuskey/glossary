import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { answerGlossaryQuestion } from "@/lib/ai/chat";
import { AiProviderError } from "@/lib/ai/provider";
import type { TermTeachingDraft } from "@/lib/ai/teaching-values";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

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
}).strict().refine((value) => value.question.length + value.history.reduce((sum, item) => sum + item.content.length, 0) <= 28_000, {
  message: "대화와 붙여넣기 내용은 합계 28,000자까지 보낼 수 있습니다.",
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
  try {
    return Response.json(await answerGlossaryQuestion(parsed.data.question, parsed.data.history, parsed.data.teachingDraft ?? null));
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "관리자가 용어 챗봇 연결을 활성화하지 않았습니다.", 503);
    }
    if (error instanceof AiProviderError) {
      const message = error.status === 404
        ? "설정된 AI 모델을 사용할 수 없습니다. 관리자에게 다른 모델을 선택해 달라고 요청하세요."
        : error.status === 401 || error.status === 403
          ? "AI API 인증에 실패했습니다. 관리자에게 API Key와 접근 권한을 확인해 달라고 요청하세요."
          : error.status === 429
            ? "AI API의 요청 한도 또는 할당량을 초과했습니다. 잠시 후 다시 시도하거나 관리자에게 확인해 주세요."
            : "AI 응답을 받지 못했습니다. 관리자에게 연결 상태를 확인해 달라고 요청하세요.";
      return apiError("ai_provider_error", message, 502);
    }
    throw error;
  }
});
