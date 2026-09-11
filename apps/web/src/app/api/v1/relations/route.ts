import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { createRelation, listRelations } from "@/lib/terms/relations";
import { relationCreateSchema, relationListSchema } from "@/lib/terms/relation-schema";
import { relationResponse } from "@/lib/terms/relation-response";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const parsed = relationListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError("validation_failed", "관계 필터를 확인해 주세요.", 400, parsed.error.flatten());
  return Response.json(await listRelations(parsed.data));
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "관계 관리는 로그인한 사용자가 수행해야 합니다.", 403);
  const parsed = relationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "용어와 관계 종류, 근거를 확인해 주세요.", 400, parsed.error.flatten());
  return relationResponse(await createRelation(parsed.data, auth.user.id), 201);
});
