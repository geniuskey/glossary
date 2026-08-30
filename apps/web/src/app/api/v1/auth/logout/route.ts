import { cookies } from "next/headers";
import { methodStubs, withApiErrors } from "@/lib/api-error";
import { clearSessionCookie, deleteSession, isSecureRequest, SESSION_COOKIE } from "@/lib/auth/session";

const ALLOWED_METHODS = ["POST"];

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);

  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", clearSessionCookie(isSecureRequest(request)));
  return res;
});
