import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { scheduleAfterResponse } from "@/lib/after-response";
import { decidePreparedRelationSuggestion, dismissPreparedSuggestion, getPreparedReview, prepareAutoReview } from "@/lib/ai/auto-review";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { currentRevisionNumber } from "@/lib/terms/update";

const ALLOWED_METHODS = ["GET", "PATCH", "DELETE"];
const { POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, OPTIONS };

const dismissSchema = z.object({
  termId: z.string().uuid(),
  revision: z.number().int().positive(),
  suggestionId: z.string().min(1).max(200),
}).strict();

const relationDecisionSchema = dismissSchema.extend({
  decision: z.enum(["approved", "rejected"]),
}).strict();

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const termId = url.searchParams.get("termId") ?? "";
  const revision = Number(url.searchParams.get("revision"));
  if (!z.string().uuid().safeParse(termId).success || !Number.isInteger(revision) || revision < 1) {
    return apiError("validation_failed", "검토할 용어와 리비전을 확인해 주세요.", 400);
  }
  const term = await getTermByIdOrSlug(termId);
  if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if (await currentRevisionNumber(termId) !== revision) {
    return apiError("revision_conflict", "용어가 변경되어 새 검토를 준비하고 있습니다.", 409);
  }
  const review = await getPreparedReview(termId, revision);
  if (!review) scheduleAfterResponse(() => prepareAutoReview(termId));
  return review ? Response.json({ state: "ready", review }) : Response.json({ state: "pending" }, { status: 202 });
});

export const DELETE = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = dismissSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "거절할 제안을 확인해 주세요.", 400, parsed.error.flatten());
  const dismissed = await dismissPreparedSuggestion(parsed.data.termId, parsed.data.revision, parsed.data.suggestionId);
  if (!dismissed) return apiError("operation_conflict", "제안이 이미 처리되었거나 오래되었습니다.", 409);
  return new Response(null, { status: 204 });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = relationDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "처리할 관계 제안을 확인해 주세요.", 400, parsed.error.flatten());
  const decided = await decidePreparedRelationSuggestion({
    ...parsed.data,
    reviewedBy: auth.kind === "user" ? auth.user.id : null,
  });
  if (!decided) return apiError("operation_conflict", "관계 제안이 이미 처리되었거나 오래되었습니다.", 409);
  return new Response(null, { status: 204 });
});
