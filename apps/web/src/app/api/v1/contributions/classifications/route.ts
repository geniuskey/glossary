import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { generateClassificationSuggestion } from "@/lib/ai/classification-review";
import { AiProviderError } from "@/lib/ai/provider";
import { isResponse, requireAuth } from "@/lib/auth/require";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  termId: z.string().uuid(),
  kind: z.enum(["domain", "category"]),
  expectedRevision: z.number().int().positive(),
  force: z.boolean().optional(),
}).strict();

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "AI 추천을 준비할 용어와 분류를 확인해 주세요.", 400, parsed.error.flatten());

  try {
    const suggestion = await generateClassificationSuggestion(parsed.data.termId, parsed.data.kind, parsed.data.expectedRevision, parsed.data.force === true, auth.kind === "user" ? auth.user.id : null);
    return Response.json({ suggestion });
  } catch (error) {
    if (error instanceof Error && error.message === "TERM_NOT_FOUND") {
      return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
    }
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      return apiError("revision_conflict", "용어가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.", 409);
    }
    if (error instanceof Error && error.message === "NOT_ELIGIBLE") {
      return apiError("operation_conflict", "이 용어는 더 이상 해당 분류 정리 대상이 아닙니다.", 409);
    }
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
    }
    if (error instanceof Error && error.message === "INVALID_AGENT_RESPONSE") {
      return apiError("ai_provider_error", "AI 추천 결과를 해석하지 못했습니다. 다시 시도해 주세요.", 502);
    }
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    throw error;
  }
});
