import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import {
  AI_SUGGESTION_DISPOSITIONS,
  AI_SUGGESTION_FEATURES,
  recordSuggestionDisposition,
  removePersonalSuggestionDecision,
} from "@/lib/ai/suggestion-dispositions";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { currentRevisionNumber } from "@/lib/terms/update";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const ALLOWED_METHODS = ["POST", "DELETE"];
const { GET, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, OPTIONS };

const recordSchema = z.object({
  termId: z.string().uuid(),
  revision: z.number().int().positive(),
  feature: z.enum(AI_SUGGESTION_FEATURES),
  suggestionId: z.string().trim().min(1).max(300),
  generatorVersion: z.number().int().positive(),
  disposition: z.enum(AI_SUGGESTION_DISPOSITIONS),
  reason: z.string().trim().max(500).optional(),
  payload: z.unknown().optional(),
}).strict();

const removeSchema = z.object({ decisionId: z.string().uuid() }).strict();

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "저장할 제안 상태를 확인해 주세요.", 400, parsed.error.flatten());
  if (parsed.data.disposition === "saved" && auth.kind !== "user") {
    return apiError("operation_conflict", "내 작업 저장은 로그인 사용자만 사용할 수 있습니다.", 409);
  }
  const term = await getTermByIdOrSlug(parsed.data.termId);
  if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  const currentRevision = await currentRevisionNumber(parsed.data.termId);
  if (currentRevision !== parsed.data.revision) {
    return apiError("revision_conflict", "용어가 변경되어 제안 상태를 저장할 수 없습니다.", 409, { currentRevision });
  }
  try {
    const decision = await recordSuggestionDisposition({
      ...parsed.data,
      userId: auth.kind === "user" ? auth.user.id : null,
      payload: parsed.data.payload && typeof parsed.data.payload === "object" && !Array.isArray(parsed.data.payload)
        ? parsed.data.payload as { title: string; field?: string; value?: unknown; reason?: string; href?: string }
        : { title: term.nameKo ?? term.nameEn ?? term.slug },
    });
    return Response.json({ ok: true, decision: { id: decision.id, disposition: decision.disposition, scope: decision.scope } });
  } catch (error) {
    if (error instanceof Error && error.message === "PERSONAL_SUGGESTION_REQUIRES_USER") {
      return apiError("operation_conflict", "내 작업 저장은 로그인 사용자만 사용할 수 있습니다.", 409);
    }
    throw error;
  }
});

export const DELETE = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("operation_conflict", "내 작업은 로그인 사용자만 관리할 수 있습니다.", 409);
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "삭제할 내 작업을 확인해 주세요.", 400, parsed.error.flatten());
  const removed = await removePersonalSuggestionDecision(parsed.data.decisionId, auth.user.id);
  if (!removed) return apiError("operation_conflict", "내 작업이 이미 처리되었거나 없습니다.", 409);
  return new Response(null, { status: 204 });
});
