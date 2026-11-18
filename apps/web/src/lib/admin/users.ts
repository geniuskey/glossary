import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
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
  /** SSO 그룹의 첫 값. 계정 메뉴의 조직 표시(current-user.ts)와 같은 규칙이다. */
  organization: string | null;
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
      ssoGroups: users.ssoGroups,
      createdAt: users.createdAt,
      activeSessions: sql<number>`count(${sessions.id})::int`,
      activeApiKeys: sql<number>`(SELECT count(*)::int FROM ${apiKeys} WHERE ${apiKeys.createdBy} = ${users.id} AND ${apiKeys.revokedAt} IS NULL AND (${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > now()))`,
    })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.userId, users.id), gt(sessions.expiresAt, new Date())))
    .groupBy(users.id)
    .orderBy(asc(users.name), asc(users.email));

  return rows.map(({ externalId, passwordHash, ssoGroups, createdAt, ...row }) => ({
    ...row,
    authType: externalId ? "sso" : passwordHash ? "password" : "agent",
    createdAt: createdAt.toISOString(),
    organization: ssoGroups?.[0] ?? null,
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
        organization: null,
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

export type ChangeRolesResult =
  | { ok: true; changed: string[] }
  | { ok: false; reason: "not_found" | "self_demotion" | "last_admin" | "actor_forbidden" | "agent_admin" };

/**
 * 여러 명의 역할을 한 트랜잭션으로 바꾼다. 하나라도 걸리면 아무것도 바꾸지 않는다 —
 * 일부만 반영하면 관리자가 화면에서 "누가 바뀌었는가"를 다시 맞춰 봐야 하고,
 * 마지막 관리자 검사는 대상 전체를 함께 봐야 의미가 있다(한 명씩 검사하면 관리자 둘을
 * 함께 내릴 때 각자는 "다른 관리자가 남아 있다"로 통과해 관리자가 0명이 된다).
 */
export async function changeManagedUserRoles(
  actorId: string,
  targetIds: readonly string[],
  role: ManagedUserRole,
): Promise<ChangeRolesResult> {
  const ids = [...new Set(targetIds)];
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glossary_admin_roles'))`);

    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1);
    if (actor?.role !== "admin") return { ok: false, reason: "actor_forbidden" };
    if (role !== "admin" && ids.includes(actorId)) return { ok: false, reason: "self_demotion" };

    const targets = await tx
      .select({ id: users.id, role: users.role, passwordHash: users.passwordHash, externalId: users.externalId })
      .from(users)
      .where(inArray(users.id, ids));
    if (targets.length !== ids.length) return { ok: false, reason: "not_found" };

    const isInteractive = (t: (typeof targets)[number]) => Boolean(t.passwordHash || t.externalId);
    if (role === "admin" && targets.some((t) => !isInteractive(t))) return { ok: false, reason: "agent_admin" };

    if (role !== "admin" && targets.some((t) => t.role === "admin" && isInteractive(t))) {
      const [remaining] = await tx.select({ value: sql<number>`count(*)::int` }).from(users)
        .where(and(eq(users.role, "admin"), notInArray(users.id, ids), interactiveAccountCondition()));
      if ((remaining?.value ?? 0) === 0) return { ok: false, reason: "last_admin" };
    }

    const changed = targets.filter((t) => t.role !== role).map((t) => t.id);
    if (changed.length > 0) await tx.update(users).set({ role }).where(inArray(users.id, changed));
    return { ok: true, changed };
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
