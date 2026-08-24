import { cookies } from "next/headers";
import { methodNotAllowed } from "@/lib/api-error";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth/session";

const ALLOWED_METHODS = ["POST"];

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);

  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return res;
}

export async function GET() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function PUT() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function PATCH() {
  return methodNotAllowed(ALLOWED_METHODS);
}

export async function DELETE() {
  return methodNotAllowed(ALLOWED_METHODS);
}
