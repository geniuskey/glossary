import { sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@glossary/db";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/register";
import { loadPasswordLoginEnabled } from "@/lib/auth/sso/config";
import { createSession, isSecureRequest, purgeExpiredSessions, sessionCookie } from "@/lib/auth/session";

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});
const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  if (!(await loadPasswordLoginEnabled())) {
    return apiError("password_login_disabled", "비밀번호 로그인이 비활성화되어 있습니다. 회사 계정으로 로그인하세요.", 403);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

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
    return apiError("unauthorized", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await purgeExpiredSessions();
  const session = await createSession(user.id);
  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.headers.append("set-cookie", sessionCookie(session.token, session.expiresAt, isSecureRequest(request)));
  return res;
});
