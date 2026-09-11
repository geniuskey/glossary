import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { changeRelation } from "@/lib/terms/relations";
import { relationChangeSchema } from "@/lib/terms/relation-schema";
import { relationResponse } from "@/lib/terms/relation-response";

const ALLOWED_METHODS = ["PATCH"];
const { GET, POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, DELETE, OPTIONS };

export const PATCH = withApiErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "관계 관리는 로그인한 사용자가 수행해야 합니다.", 403);
  const id = requireUuid((await context.params).id, "관계를 찾을 수 없습니다.");
  if (isResponse(id)) return id;
  const parsed = relationChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "변경할 관계와 근거를 확인해 주세요.", 400, parsed.error.flatten());
  return relationResponse(await changeRelation(id, parsed.data, auth.user.id));
});
