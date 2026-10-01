import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { manageAgentKeys } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { recordAuditEvent } from "@/lib/audit";

const ALLOWED_METHODS = ["POST", "DELETE"];
const { GET, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, OPTIONS };

function handler(rotate: boolean) {
  return withApiErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requireAdminUser(request);
    if (isResponse(admin)) return admin;
    const { id: rawId } = await context.params;
    const id = requireUuid(rawId, "사용자를 찾을 수 없습니다.");
    if (id instanceof Response) return id;
    const result = await manageAgentKeys(admin.id, id, rotate);
    if (!result.ok) {
      if (result.reason === "not_found") return apiError("not_found", "사용자를 찾을 수 없습니다.", 404);
      return apiError("forbidden", result.reason === "not_agent" ? "에이전트 계정의 키만 관리할 수 있습니다." : "관리자만 사용할 수 있습니다.", 403);
    }
    await recordAuditEvent({
      action: rotate ? "admin.agent_keys_rotated" : "admin.agent_keys_revoked",
      targetType: "user", targetId: id, actor: { userId: admin.id },
      metadata: { revoked: result.revoked, ...(result.key ? { keyId: result.key.id, scopes: result.key.scopes } : {}) },
    });
    const response = Response.json({ revoked: result.revoked, key: result.key }, { status: rotate ? 201 : 200 });
    response.headers.set("cache-control", "no-store");
    return response;
  });
}

/** Replaces all existing keys atomically; plain token is returned only here. */
export const POST = handler(true);
export const DELETE = handler(false);
