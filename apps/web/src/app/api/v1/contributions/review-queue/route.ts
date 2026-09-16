import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { scheduleAfterResponse } from "@/lib/after-response";
import { listReviewQueue, prepareManualReview, prepareQueuedReviews, requestManualReview, resumeReviewQueue } from "@/lib/ai/auto-review";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

const requestItemSchema = z.object({
  termId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();
const requestSchema = z.union([
  requestItemSchema,
  z.object({ items: z.array(requestItemSchema).min(1).max(60) }).strict(),
]);

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
  if (!("items" in parsed.data)) {
    const singleTermId = parsed.data.termId;
    const singleRevision = parsed.data.revision;
    if (!(await getTermByIdOrSlug(singleTermId))) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    const result = await requestManualReview(
      singleTermId,
      singleRevision,
      auth.kind === "user" ? auth.user.id : null,
    );
    if (result === "ai_disabled") return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
    if (result === "not_eligible") return apiError("operation_conflict", "현재 정리 대기 중인 용어가 아닙니다.", 409);
    if (result === "revision_conflict") return apiError("revision_conflict", "용어가 변경되었습니다. 새로고침 후 다시 요청해 주세요.", 409);

    scheduleAfterResponse(() => prepareManualReview(singleTermId));
    return Response.json({ state: "queued" }, { status: 202 });
  }

  const requestedBy = auth.kind === "user" ? auth.user.id : null;
  const uniqueItems = [...new Map(parsed.data.items.map((item) => [item.termId, item])).values()];
  const results = await Promise.all(uniqueItems.map(async (item) => {
    if (!(await getTermByIdOrSlug(item.termId))) return { item, result: "term_not_found" as const };
    return { item, result: await requestManualReview(item.termId, item.revision, requestedBy) };
  }));
  const queued = results.filter((entry) => entry.result === "queued").map((entry) => entry.item);
  const skipped = results.length - queued.length;

  if (queued.length === 0) {
    if (results.every((entry) => entry.result === "ai_disabled")) return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화해야 합니다.", 503);
    return apiError("operation_conflict", "선택한 용어 중 AI 검토를 요청할 수 있는 용어가 없습니다.", 409, { skipped });
  }

  scheduleAfterResponse(() => prepareQueuedReviews(queued.map((item) => ({ termId: item.termId, requestMode: "manual" as const })), 2));
  return Response.json({ state: "queued", requested: uniqueItems.length, queued: queued.length, skipped }, { status: 202 });
});
