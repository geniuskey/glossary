import { z } from "zod/v3";
import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { recordAuditEvent } from "@/lib/audit";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { dismissCandidate, getCandidate, toCandidateWire } from "@/lib/validation/candidates";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({ note: z.string().trim().max(500).optional() }).strict().default({});

export const POST = withApiErrors(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const rawId = (await ctx.params).id;
  const id = requireUuid(rawId, "후보를 찾을 수 없습니다.");
  if (isResponse(id)) return id;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation_failed", "무시할 후보 정보를 확인해 주세요.", 400, parsed.error.flatten());

  const existing = await getCandidate(id);
  if (!existing) return apiError("not_found", "후보를 찾을 수 없습니다.", 404);
  if (existing.status === "promoted") return apiError("operation_conflict", "이미 용어로 등록된 후보입니다.", 409);
  const candidate = await dismissCandidate(id, auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId }, parsed.data.note);
  await recordAuditEvent({
    action: "candidate.dismiss",
    targetType: "unregistered_candidate",
    targetId: id,
    actor: auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId },
    metadata: { note: parsed.data.note ?? null },
  });
  return Response.json({ candidate: toCandidateWire(candidate!) });
});
