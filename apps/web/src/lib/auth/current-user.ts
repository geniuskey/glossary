import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { sessions, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { hashSessionToken, SESSION_COOKIE } from "./session";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}
