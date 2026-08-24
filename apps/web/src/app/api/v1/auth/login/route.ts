import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, purgeExpiredSessions, SESSION_COOKIE } from "@/lib/auth/session";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  const [user] = await getDb().select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return apiError("unauthorized", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await purgeExpiredSessions();
  const session = await createSession(user.id);
  const res = Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Expires=${session.expiresAt.toUTCString()}`,
  );
  return res;
}
