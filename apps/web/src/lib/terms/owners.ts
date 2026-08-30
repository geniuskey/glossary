import { asc, eq, sql } from "drizzle-orm";
import { terms, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { userDisplayLabel } from "@/lib/workspace/identity-display-values";

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  label: string;
}

/** 용어 조회에서 담당자의 SSO 그룹/조직을 한 번에 계산한다. */
export const ownerDisplayLabelSql = sql<string | null>`(
  select case
    when coalesce(cardinality(owner_user.sso_groups), 0) > 0
    then owner_user.name || ' · ' || array_to_string(owner_user.sso_groups, ', ')
    else owner_user.name || ' · ' || owner_user.email
  end
  from users owner_user
  where owner_user.id = ${terms.ownerId}
)`;

export async function isAssignableUserId(id: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

/** 용어 책임자로 지정할 수 있는 사용자 목록. 인증 정보는 읽지 않는다. */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, ssoGroups: users.ssoGroups })
    .from(users)
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((user) => ({ id: user.id, name: user.name, email: user.email, label: userDisplayLabel(user) }));
}
