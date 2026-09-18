import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import {
  applyIdentitySuggestion,
  dismissIdentitySuggestion,
  identityCandidateFromTerm,
  prepareIdentityReview,
} from "@/lib/ai/identity-review";
import { AiProviderError } from "@/lib/ai/provider";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { currentRevisionNumber } from "@/lib/terms/update";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const ALLOWED_METHODS = ["POST", "PATCH", "DELETE"];
const { GET, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, OPTIONS };

const reviewSchema = z.object({
  termId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  force: z.boolean().optional(),
}).strict();

const suggestionSchema = z.object({
  termId: z.string().uuid(),
  revision: z.number().int().positive(),
  suggestionId: z.string().min(1).max(300),
  value: z.unknown().optional(),
}).strict();

function identityError(error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "AI_NOT_ENABLED") return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
  if (error.message === "TERM_NOT_FOUND") return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if (error.message === "REVISION_CONFLICT") return apiError("revision_conflict", "용어가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.", 409);
  if (error.message === "INVALID_IDENTITY_REVIEW") return apiError("ai_provider_error", "AI 표기 정비 결과를 해석하지 못했습니다. 다시 시도해 주세요.", 502);
  if (error.message === "INVALID_IDENTITY_VALUE") return apiError("validation_failed", "표기 정비 제안의 수정값을 확인해 주세요.", 400);
  if (error.message === "SURFACE_ALREADY_EXISTS") return apiError("operation_conflict", "같은 추가 표기가 이미 등록되어 있습니다.", 409);
  if (error.message === "SURFACE_NOT_FOUND") return apiError("operation_conflict", "변경할 추가 표기를 찾을 수 없습니다. 최신 내용을 다시 확인해 주세요.", 409);
  return null;
}

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "표기 정비를 준비할 용어와 리비전을 확인해 주세요.", 400, parsed.error.flatten());
  try {
    const review = await prepareIdentityReview(parsed.data.termId, parsed.data.expectedRevision, parsed.data.force === true, auth.kind === "user" ? auth.user.id : null);
    if (!review) return apiError("revision_conflict", "용어가 변경되어 표기 정비를 다시 준비해야 합니다.", 409);
    return Response.json({ review });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    const response = identityError(error);
    if (response) return response;
    throw error;
  }
});

export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = suggestionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "승인할 표기 정비 제안을 확인해 주세요.", 400, parsed.error.flatten());
  try {
    const outcome = await applyIdentitySuggestion({
      ...parsed.data,
      authorId: auth.kind === "user" ? auth.user.id : null,
      authorKeyId: auth.kind === "key" ? auth.keyId : null,
    });
    const result = outcome.result;
    if ("notFound" in result) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
    if ("conflict" in result) return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, { currentRevision: result.currentRevision });
    if ("invalid" in result) return apiError("validation_failed", "표기 정비 제안을 적용할 수 없습니다.", 400, { issues: result.issues });
    if ("representativeConflict" in result) return apiError("operation_conflict", "대표 표기 충돌을 먼저 해결해 주세요.", 409);
    if ("slugConflict" in result) return apiError("operation_conflict", "URL 충돌을 먼저 해결해 주세요.", 409);
    const current = await getTermByIdOrSlug(parsed.data.termId);
    const revision = await currentRevisionNumber(parsed.data.termId);
    const candidate = current
      ? identityCandidateFromTerm({
        id: current.id,
        slug: current.slug,
        nameEn: current.nameEn,
        nameKo: current.nameKo,
        fullNameEn: current.fullNameEn,
        fullNameKo: current.fullNameKo,
        surfaces: current.surfaces,
        revision,
      })
      : undefined;
    return Response.json({ ok: true, revision, review: outcome.review, candidate });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    const response = identityError(error);
    if (response) return response;
    throw error;
  }
});

export const DELETE = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = suggestionSchema.omit({ value: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "거절할 표기 정비 제안을 확인해 주세요.", 400, parsed.error.flatten());
  const dismissed = await dismissIdentitySuggestion(parsed.data.termId, parsed.data.revision, parsed.data.suggestionId);
  if (!dismissed) return apiError("operation_conflict", "표기 정비 제안이 이미 처리되었거나 오래되었습니다.", 409);
  return new Response(null, { status: 204 });
});
