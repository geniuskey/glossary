import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { changeManagedUserRoles, createManagedAgentUser, listManagedUsers } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { recordAuditEvent } from "@/lib/audit";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

const bulkRoleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  role: z.enum(["admin", "editor", "viewer"]),
}).strict();

const BULK_ROLE_CONFLICT: Record<string, string> = {
  self_demotion: "현재 로그인한 관리자의 역할은 변경할 수 없습니다. 선택에서 본인을 빼 주세요.",
  last_admin: "이대로 바꾸면 관리자가 한 명도 남지 않습니다.",
  agent_admin: "API 전용 에이전트는 관리자로 지정할 수 없습니다. 선택에서 에이전트를 빼 주세요.",
};

/** 선택한 사용자들의 역할을 한꺼번에 바꾼다. 하나라도 걸리면 아무도 바뀌지 않는다. */
export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  const parsed = bulkRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "선택한 사용자나 역할 값이 올바르지 않습니다.", 400, parsed.error.flatten());
  }

  const result = await changeManagedUserRoles(admin.id, parsed.data.ids, parsed.data.role);
  if (!result.ok && result.reason === "not_found") {
    return apiError("not_found", "선택한 사용자 중 찾을 수 없는 계정이 있습니다. 새로고침 후 다시 시도하세요.", 404);
  }
  if (!result.ok && result.reason === "actor_forbidden") {
    return apiError("forbidden", "관리자만 사용할 수 있습니다.", 403);
  }
  if (!result.ok) return apiError("operation_conflict", BULK_ROLE_CONFLICT[result.reason]!, 409);

  for (const id of result.changed) {
    await recordAuditEvent({
      action: "admin.user_role_changed",
      targetType: "user",
      targetId: id,
      actor: { userId: admin.id },
      metadata: { role: parsed.data.role, bulk: true },
    });
  }
  return Response.json({ ok: true, changed: result.changed });
});

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  return Response.json({ users: await listManagedUsers() });
});

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  const parsed = createAgentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "에이전트 이름을 확인해 주세요.", 400, parsed.error.flatten());
  }

  const created = await createManagedAgentUser(parsed.data);
  await recordAuditEvent({
    action: "admin.agent_user_created",
    targetType: "user",
    targetId: created.user.id,
    actor: { userId: admin.id },
    metadata: { role: created.user.role },
  });
  await recordAuditEvent({
    action: "api_key.created",
    targetType: "api_key",
    targetId: created.key.id,
    actor: { userId: admin.id },
    metadata: { scopes: created.key.scopes, ownerUserId: created.user.id },
  });

  return Response.json(created, { status: 201 });
});
