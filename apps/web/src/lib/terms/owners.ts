import { asc, eq, sql } from "drizzle-orm";
import { terms, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { getIdentityDisplaySettings } from "@/lib/workspace/identity-display";
import { userDisplayLabel } from "@/lib/workspace/identity-display-values";

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  label: string;
}

/** 용어 조회에서 담당자를 워크스페이스 표시 정책에 맞춰 한 번에 계산한다. */
export const ownerDisplayLabelSql = sql<string | null>`(
  select case
    when nullif(btrim(coalesce(owner_settings.member_email_domain, '')), '') is not null
      and nullif(btrim(coalesce(owner_settings.member_organization, '')), '') is not null
      and lower(split_part(owner_user.email, '@', 2)) = lower(owner_settings.member_email_domain)
    then owner_user.name || ' · ' || owner_settings.member_organization
    else owner_user.name || ' · ' || owner_user.email
  end
  from users owner_user
  left join workspace_settings owner_settings on owner_settings.id = 'default'
  where owner_user.id = ${terms.ownerId}
)`;

export async function isAssignableUserId(id: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

/** 용어 책임자로 지정할 수 있는 사용자 목록. 인증 정보는 읽지 않는다. */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const [rows, settings] = await Promise.all([
    getDb().select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name), asc(users.email)),
    getIdentityDisplaySettings(),
  ]);
  return rows.map((user) => ({ ...user, label: userDisplayLabel(user, settings) }));
}
