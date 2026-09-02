import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser, requireAuth } from "@/lib/auth/require";
import {
  createBusinessCategory,
  listManagedBusinessCategories,
  reorderBusinessCategories,
} from "@/lib/terms/categories";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

const createSchema = z.object({
  labelKo: z.string().trim().min(1).max(60),
  labelEn: z.string().trim().min(1).max(60),
}).strict();
const reorderSchema = z.object({ keys: z.array(z.string().min(1).max(64)).max(1000) }).strict();

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  return Response.json({ categories: await listManagedBusinessCategories() });
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "업무 분류 이름이 올바르지 않습니다.", 400, parsed.error.flatten());
  const category = await createBusinessCategory(parsed.data.labelKo, parsed.data.labelEn);
  if (!category) return apiError("operation_conflict", "같은 이름의 업무 분류가 이미 있습니다.", 409);
  return Response.json({ category }, { status: 201 });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "업무 분류 순서가 올바르지 않습니다.", 400, parsed.error.flatten());
  if (!(await reorderBusinessCategories(parsed.data.keys))) {
    return apiError("operation_conflict", "업무 분류 목록이 변경되었습니다. 새로고침 후 다시 시도하세요.", 409);
  }
  return Response.json({ ok: true });
});
