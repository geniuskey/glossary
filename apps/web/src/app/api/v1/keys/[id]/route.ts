import { eq } from "drizzle-orm";
import { apiKeys } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/current-user";

// R26: 유출된 키를 무력화하는 유일한 경로. 상태를 바꾸므로 DELETE여야 한다
// (GET으로 만들면 SameSite=Lax 쿠키 하나뿐인 CSRF 방어를 즉시 뚫는 취약점이 된다).
const ALLOWED_METHODS = ["DELETE"];
const { GET, POST, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, PATCH, OPTIONS };

export const DELETE = withApiErrors(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await getCurrentUser();
    if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);

    const { id: rawId } = await context.params;
    // R38: 형식이 잘못된 id는 DB까지 가지 않고 여기서 "찾을 수 없음"으로 답한다.
    const id = requireUuid(rawId, "API 키를 찾을 수 없습니다.");
    if (id instanceof Response) return id;

    const [existing] = await getDb()
      .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    if (!existing) return apiError("not_found", "API 키를 찾을 수 없습니다.", 404);

    // 멱등: 이미 폐기된 키를 다시 폐기해도 원래 폐기 시각을 덮어쓰지 않고 성공만 반환한다.
    if (!existing.revokedAt) {
      await getDb().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    }

    return Response.json({ ok: true });
  },
);
