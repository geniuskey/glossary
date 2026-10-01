import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { apiKeys, sessions, users } from "@glossary/db";
import { generateApiKey } from "@/lib/auth/api-key";
import { interactiveAccountCondition } from "@/lib/auth/account-policy";
import { getDb } from "@/lib/db";

export type ManagedUserRole = "admin" | "editor" | "viewer";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: ManagedUserRole;
  authType: "password" | "sso" | "agent";
  createdAt: string;
  activeSessions: number;
  activeApiKeys?: number;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      externalId: users.externalId,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
      activeSessions: sql<number>`count(${sessions.id})::int`,
      activeApiKeys: sql<number>`(SELECT count(*)::int FROM ${apiKeys} WHERE ${apiKeys.createdBy} = ${users.id} AND ${apiKeys.revokedAt} IS NULL AND (${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > now()))`,
    })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.userId, users.id), gt(sessions.expiresAt, new Date())))
    .groupBy(users.id, users.email, users.name, users.role, users.externalId, users.passwordHash, users.createdAt)
    .orderBy(asc(users.name), asc(users.email));

  return rows.map(({ externalId, passwordHash, createdAt, ...row }) => ({
    ...row,
    authType: externalId ? "sso" : passwordHash ? "password" : "agent",
    createdAt: createdAt.toISOString(),
  }));
}

export async function createManagedAgentUser(input: {
  name: string;
}): Promise<{ user: ManagedUser; key: { id: string; name: string; prefix: string; scopes: string[]; token: string } }> {
  const name = input.name.trim();
  const email = `agent+${randomUUID()}@agents.invalid`;
  const keyName = `${name} 에이전트 키`.slice(0, 100);
  const role = "editor" as const;
  const scopes = ["read", "write", "validate"];
  const { token, prefix, hash } = generateApiKey();

  return getDb().transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(users)
      .values({ email, name, passwordHash: null, role })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt });
    if (!createdUser) throw new Error("에이전트 계정 생성에 실패했습니다.");

    const [createdKey] = await tx
      .insert(apiKeys)
      .values({ name: keyName, prefix, keyHash: hash, scopes, createdBy: createdUser.id })
      .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes });
    if (!createdKey) throw new Error("에이전트 API 키 발급에 실패했습니다.");

    return {
      user: {
        ...createdUser,
        authType: "agent" as const,
        createdAt: createdUser.createdAt.toISOString(),
        activeSessions: 0,
        activeApiKeys: 1,
      },
      key: { ...createdKey, token },
    };
  });
}

export type ChangeRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "self_demotion" | "last_admin" | "actor_forbidden" | "agent_admin" };

export async function changeManagedUserRole(
  actorId: string,
  targetId: string,
  role: ManagedUserRole,
): Promise<ChangeRoleResult> {
  return getDb().transaction(async (tx) => {
    // 서로 다른 관리자가 동시에 상대를 강등해 관리자가 0명이 되는 경쟁 조건을
    // 막는다. 역할 변경을 직렬화한 뒤 actor 권한도 트랜잭션 안에서 다시 확인한다.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glossary_admin_roles'))`);

    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1);
    if (actor?.role !== "admin") return { ok: false, reason: "actor_forbidden" };
    if (actorId === targetId && role !== "admin") return { ok: false, reason: "self_demotion" };

    const [target] = await tx.select({ id: users.id, role: users.role, passwordHash: users.passwordHash, externalId: users.externalId }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return { ok: false, reason: "not_found" };
    if (role === "admin" && !target.passwordHash && !target.externalId) return { ok: false, reason: "agent_admin" };

    if (target.role === "admin" && role !== "admin") {
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(users)
        .where(and(eq(users.role, "admin"), ne(users.id, targetId), interactiveAccountCondition()));
      if ((target.passwordHash || target.externalId) && (count?.value ?? 0) === 0) return { ok: false, reason: "last_admin" };
    }

    await tx.update(users).set({ role }).where(eq(users.id, targetId));
    return { ok: true };
  });
}

export async function manageAgentKeys(actorId: string, targetId: string, rotate: boolean) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glossary_admin_roles'))`);
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1);
    if (actor?.role !== "admin") return { ok: false as const, reason: "actor_forbidden" as const };
    const [target] = await tx.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return { ok: false as const, reason: "not_found" as const };
    if (target.passwordHash || target.externalId) return { ok: false as const, reason: "not_agent" as const };

    const revoked = await tx.update(apiKeys).set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.createdBy, targetId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (!rotate) return { ok: true as const, revoked: revoked.length, key: null };

    const { token, prefix, hash } = generateApiKey();
    const [key] = await tx.insert(apiKeys).values({
      name: `${target.name} 에이전트 키`.slice(0, 100), prefix, keyHash: hash,
      scopes: target.role === "viewer" ? ["read", "validate"] : ["read", "write", "validate"],
      createdBy: targetId,
    }).returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes });
    if (!key) throw new Error("에이전트 API 키 발급에 실패했습니다.");
    return { ok: true as const, revoked: revoked.length, key: { ...key, token } };
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
