import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { normalizeEmail } from "@/lib/auth/register";
import { createFirstAdmin, needsSetup } from "@/lib/auth/setup";
import { createSession, isSecureRequest, sessionCookie } from "@/lib/auth/session";
import { loadPasswordLoginEnabled } from "@/lib/auth/sso/config";

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(1024),
  name: z.string().trim().min(1).max(100).optional(),
});
const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// 최초 설정 창구다. users 테이블이 비어 있을 때만 관리자 계정을 만든다. 설정이
// 끝난 뒤에는 이 엔드포인트로 계정을 만들 수 없다(로그인/키 발급 화면을 쓴다).
export const POST = withApiErrors(async (request: Request) => {
  if (!(await loadPasswordLoginEnabled())) {
    return apiError("password_login_disabled", "비밀번호 기반 최초 설정이 비활성화되어 있습니다.", 403);
  }
  // 이미 설정이 끝났으면 비밀번호 해싱(scrypt) 비용을 치르기 전에 바로 막는다.
  // 로그인과 달리 여기서는 타이밍 오라클을 걱정할 필요가 없다.
  if (!(await needsSetup())) {
    return apiError("forbidden", "이미 초기 설정이 완료되었습니다. 로그인하세요.", 403);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "이메일과 8자 이상의 비밀번호가 필요합니다.", 400, parsed.error.flatten());
  }

  // R131: 가입 경로(register.ts)와 같은 형태로 저장한다 — 저장 형태가 창구마다
  // 다르면 users_email_lower_unique가 잡아내기 전까지 아무도 눈치채지 못한다.
  const email = normalizeEmail(parsed.data.email);
  const result = await createFirstAdmin({
    email,
    name: parsed.data.name?.trim() || email,
    password: parsed.data.password,
  });
  if (!result.ok) {
    // needsSetup 확인과 insert 사이에 다른 요청이 먼저 관리자를 만든 경우다.
    return apiError("forbidden", "이미 초기 설정이 완료되었습니다. 로그인하세요.", 403);
  }

  const session = await createSession(result.user.id);
  const res = Response.json({ user: result.user });
  res.headers.append("set-cookie", sessionCookie(session.token, session.expiresAt, isSecureRequest(request)));
  return res;
});
