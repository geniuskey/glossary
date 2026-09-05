import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getDb } from "@/lib/db";

const ALLOWED_METHODS = ["PATCH"];
const { GET, POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, DELETE, OPTIONS };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "이름에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.",
  ),
}).strict();

export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "사용자 계정으로 로그인해야 합니다.", 403);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "표시 이름을 확인해 주세요.", 400, parsed.error.flatten());
  }

  const [updated] = await getDb()
    .update(users)
    .set({ name: parsed.data.name })
    .where(eq(users.id, auth.user.id))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
  if (!updated) return apiError("not_found", "사용자 계정을 찾을 수 없습니다.", 404);
  return Response.json({ user: updated });
});
