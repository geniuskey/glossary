import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser, requireAuth } from "@/lib/auth/require";
import { deleteDomain, updateDomain } from "@/lib/terms/domains";
import { DOMAIN_COLOR_KEYS } from "@/lib/terms/domain-colors";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";

const ALLOWED_METHODS = ["PATCH", "DELETE"];
const { GET, POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, OPTIONS };

const patchSchema = z.object({
  label: z.string().trim().min(1).max(DOMAIN_VALUE_MAX).optional(),
  color: z.string().refine((value) => DOMAIN_COLOR_KEYS.has(value), "팔레트에 없는 색상입니다.").optional(),
}).strict().refine((value) => value.label !== undefined || value.color !== undefined, "변경할 값이 필요합니다.");

export const PATCH = withApiErrors(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "도메인 변경 값이 올바르지 않습니다.", 400, parsed.error.flatten());
  const { key } = await context.params;
  const result = await updateDomain(key, parsed.data);
  if (result === "not_found") return apiError("not_found", "도메인을 찾을 수 없습니다.", 404);
  if (result === "duplicate_label") return apiError("operation_conflict", "같은 이름의 도메인이 이미 있습니다.", 409);
  if (result === "duplicate_color") return apiError("operation_conflict", "다른 도메인에서 사용 중인 색상입니다.", 409);
  return Response.json({ ok: true });
});

export const DELETE = withApiErrors(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const { key } = await context.params;
  const canDeleteInUse = auth.kind === "user" && auth.user.role === "admin";
  const result = await deleteDomain(key, canDeleteInUse);
  if (result === "not_found") return apiError("not_found", "도메인을 찾을 수 없습니다.", 404);
  if (result === "in_use") return apiError("forbidden", "사용 중인 도메인은 관리자만 삭제할 수 있습니다.", 403);
  return new Response(null, { status: 204 });
});
