import { z } from "zod/v3";
import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { recordAuditEvent } from "@/lib/audit";
import { scheduleAfterResponse } from "@/lib/after-response";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { prepareAutoReview } from "@/lib/ai/auto-review";
import { scheduleRagIndexing } from "@/lib/rag/indexer";
import { termInputSchema } from "@/lib/terms/schema";
import { businessCategoriesExist } from "@/lib/terms/categories";
import { domainsExist } from "@/lib/terms/domains";
import { isAssignableUserId } from "@/lib/terms/owners";
import { getCandidate, promoteCandidate, toCandidateWire } from "@/lib/validation/candidates";
import { toSurfaceWire, toTermWire, toWarningWire, type TermWriteResponse } from "@/lib/terms/wire";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const rawId = (await ctx.params).id;
  const id = requireUuid(rawId, "후보를 찾을 수 없습니다.");
  if (isResponse(id)) return id;

  const candidate = await getCandidate(id);
  if (!candidate) return apiError("not_found", "후보를 찾을 수 없습니다.", 404);
  if (candidate.status === "promoted") return apiError("operation_conflict", "이미 용어로 등록된 후보입니다.", 409);
  if (candidate.status === "dismissed") return apiError("operation_conflict", "무시된 후보는 먼저 후보 목록에서 다시 열어야 합니다.", 409);

  const parsed = termInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "등록할 용어 정보를 확인해 주세요.", 400, parsed.error.flatten());
  if (parsed.data.ownerId && !(await isAssignableUserId(parsed.data.ownerId))) {
    return apiError("validation_failed", "담당자 계정을 찾을 수 없습니다.", 400, { field: "ownerId" });
  }
  if (!(await domainsExist(parsed.data.domain))) {
    return apiError("validation_failed", "분류 체계에 없는 도메인이 포함되어 있습니다.", 400, { field: "domain" });
  }
  if (!(await businessCategoriesExist(parsed.data.category))) {
    return apiError("validation_failed", "업무 분류를 찾을 수 없습니다.", 400, { field: "category" });
  }

  const result = await promoteCandidate(
    id,
    parsed.data,
    auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId },
  );
  if (result.kind === "already_promoted") return apiError("operation_conflict", "이미 용어로 등록된 후보입니다.", 409);
  if (result.kind === "dismissed") return apiError("operation_conflict", "무시된 후보는 등록할 수 없습니다.", 409);
  if (result.kind === "not_found") return apiError("not_found", "후보를 찾을 수 없습니다.", 404);

  await recordAuditEvent({
    action: "candidate.promote",
    targetType: "unregistered_candidate",
    targetId: id,
    actor: auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId },
    metadata: { termId: result.created.term.id, status: result.created.term.status },
  });
  await recordAuditEvent({
    action: "term.create",
    targetType: "term",
    targetId: result.created.term.id,
    actor: auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId },
    metadata: { status: result.created.term.status, source: "unregistered_candidate" },
  });
  scheduleAfterResponse(() => prepareAutoReview(result.created.term.id));
  scheduleRagIndexing(1);

  const body: TermWriteResponse = {
    term: toTermWire(result.created.term),
    surfaces: result.created.surfaces.map(toSurfaceWire),
    warnings: result.created.warnings.map(toWarningWire),
  };
  return Response.json({ candidate: toCandidateWire(result.candidate), ...body }, { status: 201 });
});
