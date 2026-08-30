import { z } from "zod";
import { apiError, methodStubs, requireUuid, withApiErrors } from "@/lib/api-error";
import { changeManagedUserRole } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";

const ALLOWED_METHODS = ["PATCH"];
const { GET, POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, DELETE, OPTIONS };

const patchSchema = z.object({ role: z.enum(["admin", "editor"]) }).strict();

export const PATCH = withApiErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requireAdminUser();
    if (isResponse(admin)) return admin;

    const { id: rawId } = await context.params;
    const id = requireUuid(rawId, "사용자를 찾을 수 없습니다.");
    if (id instanceof Response) return id;

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError("validation_failed", "역할 값이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const result = await changeManagedUserRole(admin.id, id, parsed.data.role);
    if (!result.ok && result.reason === "not_found") {
      return apiError("not_found", "사용자를 찾을 수 없습니다.", 404);
    }
    if (!result.ok && result.reason === "actor_forbidden") {
      return apiError("forbidden", "관리자만 사용할 수 있습니다.", 403);
    }
    if (!result.ok && result.reason === "last_admin") {
      return apiError("operation_conflict", "마지막 관리자는 편집자로 변경할 수 없습니다.", 409);
    }
    if (!result.ok) {
      return apiError("operation_conflict", "현재 로그인한 관리자의 역할은 변경할 수 없습니다.", 409);
    }

    return Response.json({ ok: true });
  },
);
