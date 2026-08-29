import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { registerUser } from "@/lib/auth/register";
import { createSession, purgeExpiredSessions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { needsSetup } from "@/lib/auth/setup";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).optional(),
});
const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// R131: 개방 가입 창구. 로그인 화면에서 누구나 계정을 만들 수 있다.
export const POST = withApiErrors(async (request: Request) => {
  // 계정이 하나도 없을 때는 여기가 아니라 /setup이 열려야 한다. 그 순간 이 창구를
  // 열어두면 사전을 만든 첫 사람이 editor가 되어 관리자가 영영 없는 설치가 된다
  // (관리자는 최초 설정이나 seed-admin.ts로만 생긴다).
  if (await needsSetup()) {
    return apiError("forbidden", "먼저 최초 관리자 계정을 만들어야 합니다.", 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 8자 이상의 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  const result = await registerUser({
    email: parsed.data.email,
    name: parsed.data.name ?? parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) {
    // 로그인과 달리 계정 존재 여부를 숨기지 않는다. 가입 화면에서 "무엇이
    // 잘못됐는지"를 말해주지 않으면 사용자는 같은 이메일로 계속 다시 시도한다.
    // 사내망 설치이고 이메일이 이미 사람 이름과 함께 이력에 드러나므로,
    // 여기서 감추는 것으로 얻는 것이 없다.
    return apiError("email_taken", "이미 가입된 이메일입니다. 로그인하세요.", 409);
  }

  // 가입 직후 바로 들어간다 — 방금 만든 계정으로 다시 로그인 폼을 채우게 하지 않는다.
  await purgeExpiredSessions();
  const session = await createSession(result.user.id);
  const res = Response.json({ user: result.user });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Expires=${session.expiresAt.toUTCString()}`,
  );
  return res;
});
