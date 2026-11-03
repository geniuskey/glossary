import { sql } from "drizzle-orm";
import { z } from "zod/v3";
import { users } from "@glossary/db";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { recordAuditEvent } from "@/lib/audit";
import { isAllowedCsrfOrigin } from "@/lib/auth/csrf";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/register";
import { loadPasswordLoginEnabled } from "@/lib/auth/sso/config";
import { createSession, isSecureRequest, purgeExpiredSessions, sessionCookie } from "@/lib/auth/session";
import { consumeAddressRateLimit, consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});
const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

/**
 * 로그인 CSRF(공격자 계정으로 피해자 브라우저를 로그인시키는 것)를 막는다. enforceCsrf는
 * Origin·Referer가 없는 요청도 거절해서 문서화된 curl·스크립트 로그인 호출을 깨므로 쓰지 않는다.
 * 브라우저는 교차 출처 POST에 Origin을 항상 붙이므로, Origin이 있을 때만 검사해도 충분하다.
 */
function crossOriginBrowserRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return false;
  const origin = request.headers.get("origin");
  return origin !== null && !isAllowedCsrfOrigin(request, origin);
}

export const POST = withApiErrors(async (request: Request) => {
  if (crossOriginBrowserRequest(request)) {
    return apiError("csrf_failed", "요청 출처를 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", 403);
  }
  if (!(await loadPasswordLoginEnabled())) {
    return apiError("password_login_disabled", "비밀번호 로그인이 비활성화되어 있습니다. 회사 계정으로 로그인하세요.", 403);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  const email = normalizeEmail(parsed.data.email);
  const [emailLimit, addressLimit] = await Promise.all([
    consumeRateLimit(`auth:login:email:${email}`, 10, 15 * 60_000),
    consumeAddressRateLimit(request, "auth:login", 50, 15 * 60_000),
  ]);
  const limited = rateLimitResponse(
    emailLimit.allowed ? addressLimit : emailLimit,
    "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  );
  if (limited) return limited;

  // R131: 대소문자를 구분하지 않고 찾는다. 개방 가입에서는 "Kim@Example.com"으로
  // 가입해 놓고 다음 날 소문자로 치는 일이 흔한데, 원문 일치로만 찾으면 그 사람은
  // 자기 계정을 영영 못 찾고 "비밀번호가 틀렸다"는 말만 듣는다. 유일성은
  // users_email_lower_unique가 지키므로 이 조회가 두 계정을 만날 일은 없다.
  const [user] = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(parsed.data.email)}`)
    .limit(1);
  // 계정이 없어도 scrypt 검증을 고정 더미 해시로 항상 완주시킨다. 그렇지 않으면
  // "계정 없음" 경로가 scrypt를 통째로 건너뛰어 응답 시간으로 계정 존재 여부가 샌다.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    await recordAuditEvent({ action: "auth.login_failed", targetType: "auth", metadata: { reason: "invalid_credentials" } });
    return apiError("unauthorized", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await purgeExpiredSessions();
  const session = await createSession(user.id);
  await recordAuditEvent({ action: "auth.login_success", targetType: "user", targetId: user.id, actor: { userId: user.id } });
  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.headers.append("set-cookie", sessionCookie(session.token, session.expiresAt, isSecureRequest(request)));
  return res;
});
