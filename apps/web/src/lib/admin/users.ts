import "server-only";

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { sessions, users } from "@grossary/db";
import { getDb } from "@/lib/db";

export type ManagedUserRole = "admin" | "editor";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: ManagedUserRole;
  authType: "password" | "sso";
  createdAt: string;
  activeSessions: number;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      externalId: users.externalId,
      createdAt: users.createdAt,
      activeSessions: sql<number>`count(${sessions.id})::int`,
    })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.userId, users.id), gt(sessions.expiresAt, new Date())))
    .groupBy(users.id, users.email, users.name, users.role, users.externalId, users.createdAt)
    .orderBy(asc(users.name), asc(users.email));

  return rows.map(({ externalId, createdAt, ...row }) => ({
    ...row,
    authType: externalId ? "sso" : "password",
    createdAt: createdAt.toISOString(),
  }));
}

export type ChangeRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "self_demotion" | "last_admin" | "actor_forbidden" };

export async function changeManagedUserRole(
  actorId: string,
  targetId: string,
  role: ManagedUserRole,
): Promise<ChangeRoleResult> {
  return getDb().transaction(async (tx) => {
    // 서로 다른 관리자가 동시에 상대를 강등해 관리자가 0명이 되는 경쟁 조건을
    // 막는다. 역할 변경을 직렬화한 뒤 actor 권한도 트랜잭션 안에서 다시 확인한다.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('grossary_admin_roles'))`);

    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1);
    if (actor?.role !== "admin") return { ok: false, reason: "actor_forbidden" };
    if (actorId === targetId && role !== "admin") return { ok: false, reason: "self_demotion" };

    const [target] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return { ok: false, reason: "not_found" };

    if (target.role === "admin" && role === "editor") {
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "admin"));
      if ((count?.value ?? 0) <= 1) return { ok: false, reason: "last_admin" };
    }

    await tx.update(users).set({ role }).where(eq(users.id, targetId));
    return { ok: true };
  });
}

export type RevokeSessionsResult =
  | { ok: true; revoked: number }
  | { ok: false; reason: "not_found" | "self_target" | "actor_forbidden" };

export async function revokeManagedUserSessions(
  actorId: string,
  targetId: string,
): Promise<RevokeSessionsResult> {
  return getDb().transaction(async (tx) => {
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1);
    if (actor?.role !== "admin") return { ok: false, reason: "actor_forbidden" };
    if (actorId === targetId) return { ok: false, reason: "self_target" };

    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return { ok: false, reason: "not_found" };

    const deleted = await tx.delete(sessions).where(eq(sessions.userId, targetId)).returning({ id: sessions.id });
    return { ok: true, revoked: deleted.length };
  });
}
