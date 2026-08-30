import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { revokeManagedUserSessions } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";

const ALLOWED_METHODS = ["DELETE"];
const { GET, POST, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, PATCH, OPTIONS };

export const DELETE = withApiErrors(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requireAdminUser();
    if (isResponse(admin)) return admin;

    const { id: rawId } = await context.params;
    const id = requireUuid(rawId, "사용자를 찾을 수 없습니다.");
    if (id instanceof Response) return id;

    const result = await revokeManagedUserSessions(admin.id, id);
    if (!result.ok && result.reason === "not_found") {
      return apiError("not_found", "사용자를 찾을 수 없습니다.", 404);
    }
    if (!result.ok && result.reason === "actor_forbidden") {
      return apiError("forbidden", "관리자만 사용할 수 있습니다.", 403);
    }
    if (!result.ok) {
      return apiError("operation_conflict", "현재 로그인한 세션은 여기서 종료할 수 없습니다. 로그아웃을 사용하세요.", 409);
    }

    return Response.json({ ok: true, revoked: result.revoked });
  },
);
