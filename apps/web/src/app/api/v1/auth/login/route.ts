import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession, purgeExpiredSessions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  const [user] = await getDb().select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  // 계정이 없어도 scrypt 검증을 고정 더미 해시로 항상 완주시킨다. 그렇지 않으면
  // "계정 없음" 경로가 scrypt를 통째로 건너뛰어 응답 시간으로 계정 존재 여부가 샌다.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    return apiError("unauthorized", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await purgeExpiredSessions();
  const session = await createSession(user.id);
  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Expires=${session.expiresAt.toUTCString()}`,
  );
  return res;
});
