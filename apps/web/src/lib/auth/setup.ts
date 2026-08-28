import { sql } from "drizzle-orm";
import { users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { hashPassword } from "./password";

/** 관리자(사용자)가 하나도 없으면 최초 설정이 필요하다 — NocoDB식 첫 접속 온보딩. */
export async function needsSetup(): Promise<boolean> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return (row?.n ?? 0) === 0;
}

export type SetupResult =
  | { ok: true; user: { id: string; email: string; name: string; role: "admin" | "editor" } }
  | { ok: false; reason: "already_setup" };

/**
 * 최초 관리자 계정을 만든다. users 테이블이 비어 있을 때만 성공한다.
 *
 * 트랜잭션 안에서 advisory lock을 먼저 잡고 건수를 확인한 뒤 insert한다.
 * 두 요청이 동시에 들어와도 락이 직렬화하므로 둘째는 already_setup으로 떨어진다 —
 * 최초 설정 창구가 "먼저 도달한 사람이 관리자"인 것은 첫 요청 한 번뿐이어야 한다.
 */
export async function createFirstAdmin(input: {
  email: string;
  name: string;
  password: string;
}): Promise<SetupResult> {
  const passwordHash = await hashPassword(input.password);

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('grossary_setup'))`);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((c?.n ?? 0) > 0) return { ok: false, reason: "already_setup" };

    const [created] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash, role: "admin" })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    // 락을 쥔 채 건수 0을 확인한 뒤라 insert는 반드시 한 행을 돌려준다.
    // 타입상으로만 undefined 가능성이 남아 방어한다(발생하면 트랜잭션이 롤백된다).
    if (!created) throw new Error("최초 관리자 계정 생성에 실패했습니다.");
    return { ok: true, user: created };
  });
}
