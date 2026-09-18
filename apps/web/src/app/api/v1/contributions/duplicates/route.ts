import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { duplicateCandidates, duplicateInputSchema, listDuplicateReviewPairs, reviewDuplicates, saveDuplicateDecision, type DuplicateInput } from "@/lib/ai/duplicate-review";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { currentRevisionNumber } from "@/lib/terms/update";
import { mergeTerms } from "@/lib/terms/merge";
import { scheduleRagIndexing } from "@/lib/rag/indexer";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read"); if (isResponse(auth)) return auth;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const rawStatus = params.get("status") ?? "pending";
  const status = rawStatus === "all" || rawStatus === "different" || rawStatus === "uncertain" ? rawStatus : "pending";
  return Response.json(await listDuplicateReviewPairs(page, status, 30, auth.kind === "user" ? auth.user.id : null));
});

const reviewSchema = z.union([
  z.object({ termId: z.string().uuid(), candidateId: z.string().uuid().optional() }),
  z.object({ source: duplicateInputSchema.extend({ id: z.string().regex(/^row:\d+$/) }), candidates: z.array(duplicateInputSchema.extend({ id: z.string().regex(/^row:\d+$/) })).max(30).default([]) }),
]);
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write"); if (isResponse(auth)) return auth;
  const raw = await request.text();
  if (raw.length > 200000) return apiError("payload_too_large", "검토 자료가 너무 큽니다.", 413);
  let value; try { value = JSON.parse(raw); } catch { return apiError("validation_failed", "검토 자료를 확인해 주세요.", 400); }
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) return apiError("validation_failed", "검토 자료를 확인해 주세요.", 400);
  const data = parsed.data;
  const revision = "termId" in data ? await currentRevisionNumber(data.termId) : undefined;
  const source = "termId" in data ? await getTermByIdOrSlug(data.termId) : data.source;
  if (!source) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if ("termId" in data && await currentRevisionNumber(data.termId) !== revision) return apiError("revision_conflict", "용어가 변경되었습니다. 다시 검토해 주세요.", 409);
  const storedCandidates = await duplicateCandidates(source);
  let candidates: Array<DuplicateInput & { revision?: number }> = [...("candidates" in data ? data.candidates.filter((c) => c.id !== source.id) : []), ...storedCandidates];
  if ("termId" in data && data.candidateId) {
    const explicitCandidate = await getTermByIdOrSlug(data.candidateId);
    if (!explicitCandidate || explicitCandidate.id === source.id) return apiError("term_not_found", "비교할 후보 용어를 찾을 수 없습니다.", 404);
    candidates = [{ ...explicitCandidate, revision: await currentRevisionNumber(explicitCandidate.id) }];
  }
  candidates = candidates.filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);
  // Capture revisions before AI runs, so concurrent edits invalidate the approval.
  const revisions = new Map(storedCandidates.map((c) => [c.id, c.revision]));
  if ("termId" in data && data.candidateId && candidates[0]) revisions.set(candidates[0].id, candidates[0].revision ?? await currentRevisionNumber(candidates[0].id));
  try {
    const reviewed = await reviewDuplicates(source, candidates);
    return Response.json({ source, revision, candidates: reviewed.map((c) => ({ ...c, revision: revisions.get(c.id) })) });
  } catch (error) {
    return apiError("operation_conflict", error instanceof Error && error.message.startsWith("AI 중복") ? error.message : "AI 중복 검토를 완료하지 못했습니다. AI 설정을 확인하고 다시 시도해 주세요.", 409);
  }
});

const mergeSchema = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid(), sourceRevision: z.number().int().positive(), targetRevision: z.number().int().positive() }).strict();
const decisionSchema = z.object({
  action: z.literal("decide"),
  leftId: z.string().uuid(),
  rightId: z.string().uuid(),
  leftRevision: z.number().int().positive(),
  rightRevision: z.number().int().positive(),
  decision: z.enum(["different", "uncertain"]),
  reason: z.string().trim().max(1000).optional(),
}).strict();
export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write"); if (isResponse(auth)) return auth;
  const parsed = z.union([mergeSchema, decisionSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "병합할 두 용어와 리비전을 확인해 주세요.", 400);
  const d = parsed.data;
  if ("action" in d) {
    try {
      const result = await saveDuplicateDecision({
        leftId: d.leftId,
        rightId: d.rightId,
        leftRevision: d.leftRevision,
        rightRevision: d.rightRevision,
        decision: d.decision,
        reason: d.reason,
        reviewedBy: auth.kind === "user" ? auth.user.id : null,
      });
      return Response.json(result);
    } catch (error) {
      return apiError("operation_conflict", error instanceof Error ? error.message : "검토 결과를 저장하지 못했습니다.", 409);
    }
  }
  try {
    const merged = await mergeTerms(d.sourceId, d.targetId, d.sourceRevision, d.targetRevision, auth.kind === "user" ? auth.user.id : null, auth.kind === "key" ? auth.keyId : null);
    scheduleRagIndexing(1);
    return Response.json(merged);
  }
  catch { return apiError("operation_conflict", "병합하지 못했습니다. 용어 변경·표기 충돌·이미 병합된 대상인지 확인하고 다시 검토해 주세요.", 409); }
});
