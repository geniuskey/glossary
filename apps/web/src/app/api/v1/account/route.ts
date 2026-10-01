import { eq } from "drizzle-orm";
import { z } from "zod/v3";
import { users } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth, requireSessionUser } from "@/lib/auth/require";
import { normalizeEmail } from "@/lib/auth/register";
import { clearSessionCookie, isSecureRequest } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { deleteOwnAccount } from "@/lib/auth/delete-account";
import { recordAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";

const ALLOWED_METHODS = ["PATCH", "DELETE"];
const { GET, POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, POST, PUT, OPTIONS };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "이름에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.",
  ),
}).strict();

const deleteSchema = z.object({
  confirmEmail: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024).optional(),
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

export const DELETE = withApiErrors(async (request: Request) => {
  const auth = await requireSessionUser(request);
  if (isResponse(auth)) return auth;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "계정 이메일을 입력하고 요청 내용을 확인해 주세요.", 400, parsed.error.flatten());
  }

  const [account] = await getDb()
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, auth.id))
    .limit(1);
  if (!account) return apiError("not_found", "사용자 계정을 찾을 수 없습니다.", 404);

  if (normalizeEmail(parsed.data.confirmEmail) !== normalizeEmail(account.email)) {
    return apiError("forbidden", "입력한 이메일이 현재 계정과 일치하지 않습니다.", 403);
  }
  if (account.passwordHash && (!parsed.data.password || !(await verifyPassword(parsed.data.password, account.passwordHash)))) {
    return apiError("forbidden", "현재 비밀번호가 올바르지 않습니다.", 403);
  }

  const result = await deleteOwnAccount(auth.id, normalizeEmail(account.email));
  if (!result.ok) {
    if (result.reason === "not_found") return apiError("not_found", "사용자 계정을 찾을 수 없습니다.", 404);
    if (result.reason === "last_admin") {
      return apiError("forbidden", "마지막 관리자 계정은 탈퇴할 수 없습니다. 먼저 다른 관리자에게 권한을 넘겨 주세요.", 403);
    }
    return apiError("forbidden", "계정 정보가 변경되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", 403);
  }

  await recordAuditEvent({ action: "auth.account_deleted", targetType: "user", targetId: auth.id });
  const response = Response.json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie(isSecureRequest(request)));
  return response;
});
