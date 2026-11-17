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
  // 제안은 에이전트(API 키)도 할 수 있다. 제안은 proposed로만 저장되고 검색 그래프에는 들어가지 않으며,
  // 승인·거절·수정(PATCH /relations/{id})은 여전히 로그인한 사람만 한다. 사내 에이전트가 관계 정리를
  // 끝까지 하려면 제안을 저장할 수 있어야 했다.
  const parsed = relationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "용어와 관계 종류, 근거를 확인해 주세요.", 400, parsed.error.flatten());
  return relationResponse(await createRelation(parsed.data, auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId }), 201);
});
