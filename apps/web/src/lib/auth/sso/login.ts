import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "@glossary/db";
import { getDb } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { SsoIdentity } from "./claims";
import { looksLikeMojibake } from "./encoding";

export type SsoLoginResult =
  | { ok: true; user: CurrentUser; created: boolean }
  | { ok: false; reason: "no_account" | "email_conflict" | "identity_mismatch" };

/**
 * R132: IdP가 확인해 준 사람을 이 앱의 계정에 붙인다.
 *
 * 계정을 찾는 열쇠는 **이메일이 아니라 sub**다. 사람은 이름도 이메일도 바꾸지만
 * sub는 그대로라서, sub로 먼저 찾아야 이메일이 바뀐 사람이 새 계정으로 갈라지지 않는다.
 * 이메일 조회는 "SSO를 켜기 전에 비밀번호로 쓰던 계정"을 한 번 이어 붙이기 위한
 * 경로다(그 뒤로는 external_id로 찾는다).
 */
export async function applySsoLogin(input: {
  identity: SsoIdentity;
  isAdmin: boolean;
  autoCreate: boolean;
  /** 사용자가 명시적으로 요청한 재동기화에서는 로컬에서 바꾼 표시 이름도 IdP 값으로 되돌린다. */
  refreshProfile?: boolean;
  /** 재동기화 도중 다른 회사 계정을 선택해 현재 세션과 다른 계정을 덮어쓰는 일을 막는다. */
  expectedUserId?: string;
}): Promise<SsoLoginResult> {
  const { identity, isAdmin, autoCreate, refreshProfile = false, expectedUserId } = input;
  const db = getDb();

  return db.transaction(async (tx) => {
    const [bySubject] = await tx.select().from(users).where(eq(users.externalId, identity.subject)).limit(1);
    if (bySubject) {
      if (expectedUserId && bySubject.id !== expectedUserId) {
        return { ok: false as const, reason: "identity_mismatch" as const };
      }
      const patch = await syncPatch(tx, bySubject, identity, isAdmin, refreshProfile);
      return { ok: true as const, user: await applyPatch(tx, bySubject, patch), created: false };
    }

    const [byEmail] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${identity.email}`)
      .limit(1);
    if (byEmail) {
      if (expectedUserId && byEmail.id !== expectedUserId) {
        return { ok: false as const, reason: "identity_mismatch" as const };
      }
      // 이미 다른 sub에 묶인 계정이다. 덮어쓰면 IdP에서 계정 하나를 지웠다 다시 만든
      // 사람이 남의 이력을 이어받는 일이 생기므로, 사람이 개입하도록 막는다.
      if (byEmail.externalId && byEmail.externalId !== identity.subject) {
        return { ok: false as const, reason: "email_conflict" as const };
      }
      const patch = await syncPatch(tx, byEmail, identity, isAdmin, refreshProfile);
      return {
        ok: true as const,
        user: await applyPatch(tx, byEmail, { ...patch, externalId: identity.subject }),
        created: false,
      };
    }

    if (expectedUserId) return { ok: false as const, reason: "identity_mismatch" as const };
    if (!autoCreate) return { ok: false as const, reason: "no_account" as const };

    // 비밀번호는 없다(null). 이 계정은 SSO로만 들어온다 — 임의의 해시를 채워 넣으면
    // "비밀번호가 있는 것처럼 보이지만 아무도 모르는 계정"이 되어 재설정 흐름이 헷갈린다.
    const [created] = await tx
      .insert(users)
      .values({
        email: identity.email,
        name: identity.name,
        passwordHash: null,
        externalId: identity.subject,
        ssoGroups: identity.groups,
        role: isAdmin ? "admin" : "editor",
      })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    if (!created) throw new Error("SSO 계정 생성에 실패했습니다.");
    return { ok: true as const, user: created, created: true };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type UserRow = typeof users.$inferSelect;

/**
 * 그룹·이메일은 로그인할 때마다 IdP 값을 따라가고 역할은 올리기만 한다.
 * 표시 이름은 최초 생성 뒤 사용자가 직접 관리한다. 다만 과거 mojibake 이름은
 * 정상 SSO 이름으로 한 번 복구한다.
 */
async function syncPatch(
  tx: Tx,
  existing: UserRow,
  identity: SsoIdentity,
  isAdmin: boolean,
  refreshProfile: boolean,
): Promise<Partial<UserRow>> {
  const patch: Partial<UserRow> = {};
  if (
    identity.name
    && identity.name !== existing.name
    && (refreshProfile || looksLikeMojibake(existing.name))
  ) patch.name = identity.name;
  if (!sameGroups(identity.groups, existing.ssoGroups)) patch.ssoGroups = identity.groups;
  if (isAdmin && existing.role !== "admin") patch.role = "admin";

  if (existing.email.toLowerCase() !== identity.email) {
    // 이메일이 바뀐 사람을 따라가되, 그 주소를 이미 다른 계정이 쓰고 있으면 그대로 둔다
    // (users_email_lower_unique 위반으로 로그인 전체가 500이 되는 것보다 낫다).
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${identity.email}`, ne(users.id, existing.id)))
      .limit(1);
    if (!taken) patch.email = identity.email;
  }
  return patch;
}

function sameGroups(current: readonly string[], saved: readonly string[] | null): boolean {
  return saved !== null && current.length === saved.length && current.every((group, index) => group === saved[index]);
}

async function applyPatch(tx: Tx, existing: UserRow, patch: Partial<UserRow>): Promise<CurrentUser> {
  if (Object.keys(patch).length === 0) {
    return { id: existing.id, email: existing.email, name: existing.name, role: existing.role };
  }
  const [updated] = await tx
    .update(users)
    .set(patch)
    .where(eq(users.id, existing.id))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
  if (!updated) throw new Error("SSO 계정 갱신에 실패했습니다.");
  return updated;
}
