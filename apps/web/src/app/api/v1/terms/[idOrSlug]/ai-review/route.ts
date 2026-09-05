import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { reviewTermDraft } from "@/lib/ai/edit-review";
import { AiProviderError } from "@/lib/ai/provider";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { termInputBaseSchema } from "@/lib/terms/schema";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const reviewRequestSchema = z.object({
  term: termInputBaseSchema,
  instruction: z.string().trim().max(1_000).optional(),
}).strict();

export const POST = withApiErrors(async (request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const { idOrSlug } = await ctx.params;
  const existing = await getTermByIdOrSlug(idOrSlug);
  if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  // 저장 스키마의 최종 무결성 검사는 적용·저장 시점에 맡긴다. 이름이 비었거나
  // 표기가 충돌하는 작성 중 상태야말로 AI 검토가 도와야 하는 입력이다.
  const parsed = reviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "검토할 용어 입력을 확인해 주세요.", 400, parsed.error.flatten());
  try {
    return Response.json({ review: await reviewTermDraft({
      ...parsed.data.term,
      nameEn: parsed.data.term.nameEn ?? undefined,
      nameKo: parsed.data.term.nameKo ?? undefined,
      fullNameEn: parsed.data.term.fullNameEn ?? undefined,
      fullNameKo: parsed.data.term.fullNameKo ?? undefined,
      topic: parsed.data.term.topic ?? null,
      ownerId: parsed.data.term.ownerId ?? null,
    }, existing.slug, parsed.data.instruction) });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
    }
    if (error instanceof Error && error.message === "INVALID_EDIT_REVIEW") {
      return apiError("ai_provider_error", "AI 검토 결과를 해석하지 못했습니다. 다시 시도해 주세요.", 502);
    }
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    throw error;
  }
});
