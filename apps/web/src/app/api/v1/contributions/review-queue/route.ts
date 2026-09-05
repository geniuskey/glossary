import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { scheduleAfterResponse } from "@/lib/after-response";
import { listReviewQueue, prepareManualReview, requestManualReview, resumeReviewQueue } from "@/lib/ai/auto-review";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  termId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  scheduleAfterResponse(() => resumeReviewQueue());
  return Response.json({ queue: await listReviewQueue() });
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "검토할 용어와 리비전을 확인해 주세요.", 400, parsed.error.flatten());
  if (!(await getTermByIdOrSlug(parsed.data.termId))) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

  const result = await requestManualReview(
    parsed.data.termId,
    parsed.data.revision,
    auth.kind === "user" ? auth.user.id : null,
  );
  if (result === "ai_disabled") return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
  if (result === "not_eligible") return apiError("operation_conflict", "현재 정리 대기 중인 용어가 아닙니다.", 409);
  if (result === "revision_conflict") return apiError("revision_conflict", "용어가 변경되었습니다. 새로고침 후 다시 요청해 주세요.", 409);

  scheduleAfterResponse(() => prepareManualReview(parsed.data.termId));
  return Response.json({ state: "queued" }, { status: 202 });
});
