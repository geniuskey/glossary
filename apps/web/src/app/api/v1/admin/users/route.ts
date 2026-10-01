import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { createManagedAgentUser, listManagedUsers } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { recordAuditEvent } from "@/lib/audit";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

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
