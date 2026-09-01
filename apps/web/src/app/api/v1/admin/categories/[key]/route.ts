import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { deleteBusinessCategory, renameBusinessCategory } from "@/lib/terms/categories";

const ALLOWED_METHODS = ["PATCH", "DELETE"];
const { GET, POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, OPTIONS };

const patchSchema = z.object({ label: z.string().trim().min(1).max(60) }).strict();

export const PATCH = withApiErrors(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "업무 분류 이름이 올바르지 않습니다.", 400, parsed.error.flatten());
  const { key } = await context.params;
  const result = await renameBusinessCategory(key, parsed.data.label);
  if (result === "not_found") return apiError("not_found", "업무 분류를 찾을 수 없습니다.", 404);
  if (result === "duplicate") return apiError("operation_conflict", "같은 이름의 업무 분류가 이미 있습니다.", 409);
  return Response.json({ ok: true });
});

export const DELETE = withApiErrors(async (_request: Request, context: { params: Promise<{ key: string }> }) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const { key } = await context.params;
  const result = await deleteBusinessCategory(key);
  if (result === "not_found") return apiError("not_found", "업무 분류를 찾을 수 없습니다.", 404);
  if (result === "in_use") return apiError("operation_conflict", "사용 중인 업무 분류는 삭제할 수 없습니다.", 409);
  return new Response(null, { status: 204 });
});
