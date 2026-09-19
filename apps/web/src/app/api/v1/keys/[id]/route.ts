import { and, eq } from "drizzle-orm";
import { apiKeys } from "@glossary/db";
import { recordAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { isResponse, requireSessionUser } from "@/lib/auth/require";

// R26: 유출된 키를 무력화하는 유일한 경로. 상태를 바꾸므로 DELETE여야 한다
// (GET으로 만들면 Origin/Referer 검증과 SameSite=Lax 쿠키를 우회하는 취약점이 된다).
const ALLOWED_METHODS = ["DELETE"];
const { GET, POST, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, PATCH, OPTIONS };

export const DELETE = withApiErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireSessionUser(request);
    if (isResponse(user)) return user;

    const { id: rawId } = await context.params;
    // R38: 형식이 잘못된 id는 DB까지 가지 않고 여기서 "찾을 수 없음"으로 답한다.
    const id = requireUuid(rawId, "API 키를 찾을 수 없습니다.");
    if (id instanceof Response) return id;

    const [existing] = await getDb()
      .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      // 존재 여부도 다른 사용자에게 공개하지 않는다. 소유하지 않은 키는
      // 자신의 키 목록에 없는 것과 같은 404로 처리한다.
      .where(and(eq(apiKeys.id, id), eq(apiKeys.createdBy, user.id)))
      .limit(1);

    if (!existing) return apiError("not_found", "API 키를 찾을 수 없습니다.", 404);

    // 멱등: 이미 폐기된 키를 다시 폐기해도 원래 폐기 시각을 덮어쓰지 않고 성공만 반환한다.
    if (!existing.revokedAt) {
      await getDb().update(apiKeys).set({ revokedAt: new Date() }).where(and(
        eq(apiKeys.id, id),
        eq(apiKeys.createdBy, user.id),
      ));
      await recordAuditEvent({
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: id,
        actor: { userId: user.id },
      });
    }

    return Response.json({ ok: true });
  },
);
