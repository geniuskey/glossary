import { eq, sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { createDb, users } from "@grossary/db";
import { applySsoLogin } from "../src/lib/auth/sso/login.js";
import { hashPassword } from "../src/lib/auth/password.js";

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function identity(over: Partial<{ subject: string; email: string; name: string; groups: string[] }> = {}) {
  return {
    subject: over.subject ?? unique("sub"),
    email: over.email ?? `${unique("sso")}@example.com`,
    name: over.name ?? "김철수",
    groups: over.groups ?? [],
  };
}

async function login(input: Parameters<typeof applySsoLogin>[0]) {
  const result = await applySsoLogin(input);
  if (result.ok) createdUserIds.push(result.user.id);
  return result;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row!;
}

test("처음 온 사람의 계정을 만들고 비밀번호는 두지 않는다", async () => {
  const id = identity();

  const result = await login({ identity: id, isAdmin: false, autoCreate: true });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const row = await rowOf(result.user.id);
  expect(result.created).toBe(true);
  expect(row.externalId).toBe(id.subject);
  expect(row.ssoGroups).toEqual(id.groups);
  expect(row.role).toBe("editor");
  // 임의의 해시를 채우면 "비밀번호가 있는 것처럼 보이지만 아무도 모르는 계정"이 된다.
  expect(row.passwordHash).toBeNull();
});

test("자동 생성이 꺼져 있으면 계정을 만들지 않는다", async () => {
  const result = await login({ identity: identity(), isAdmin: false, autoCreate: false });

  expect(result).toEqual({ ok: false, reason: "no_account" });
});

// 계정을 찾는 열쇠는 이메일이 아니라 sub다. 이메일로만 찾으면 회사 이메일이 바뀐
// 사람이 새 계정으로 갈라지고, 그때부터 이력이 두 사람 것으로 쪼개진다.
test("이메일이 바뀌어도 같은 sub면 같은 계정이다", async () => {
  const first = identity();
  const created = await login({ identity: first, isAdmin: false, autoCreate: true });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const again = await login({
    identity: { ...first, email: `${unique("changed")}@example.com`, name: "김철수(변경)" },
    isAdmin: false,
    autoCreate: true,
  });

  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.user.id).toBe(created.user.id);
  expect(again.created).toBe(false);
  const row = await rowOf(again.user.id);
  expect(row.name).toBe("김철수(변경)");
  expect(row.email).not.toBe(first.email);
});

// SSO를 켜기 전부터 비밀번호로 쓰던 계정을 한 번 이어 붙이는 경로다.
test("이메일이 같은 기존 계정에 sub를 붙인다", async () => {
  const email = `${unique("legacy")}@example.com`;
  const [existing] = await db
    .insert(users)
    .values({ email, name: "기존 사용자", passwordHash: await hashPassword("irrelevant"), role: "editor" })
    .returning();
  createdUserIds.push(existing!.id);

  const result = await login({ identity: identity({ email }), isAdmin: false, autoCreate: true });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.user.id).toBe(existing!.id);
  const row = await rowOf(existing!.id);
  expect(row.externalId).not.toBeNull();
  // 비밀번호는 남는다 — SSO가 꺼지면 원래대로 로그인할 수 있어야 한다.
  expect(row.passwordHash).not.toBeNull();
});

// IdP에서 계정을 지웠다 다시 만든 사람은 이메일이 같고 sub가 다르다. 덮어쓰면
// 그 사람이 남의 이력을 이어받는다 — 사람이 개입하도록 막는다.
test("이미 다른 sub에 묶인 이메일은 거절한다", async () => {
  const email = `${unique("bound")}@example.com`;
  const first = await login({ identity: identity({ email }), isAdmin: false, autoCreate: true });
  expect(first.ok).toBe(true);

  const result = await login({ identity: identity({ email }), isAdmin: false, autoCreate: true });

  expect(result).toEqual({ ok: false, reason: "email_conflict" });
});

// 그룹 claim이 한 번 비어서 오는 것만으로 관리자가 편집자로 떨어지면, 그 순간
// 아무도 계정을 되돌릴 수 없다(관리자 전용 화면에서 잠긴다).
test("역할은 올라가기만 하고 내려가지 않는다", async () => {
  const id = identity();
  const created = await login({ identity: id, isAdmin: false, autoCreate: true });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const promoted = await login({ identity: id, isAdmin: true, autoCreate: true });
  expect(promoted.ok && promoted.user.role).toBe("admin");

  const demoted = await login({ identity: id, isAdmin: false, autoCreate: true });
  expect(demoted.ok && demoted.user.role).toBe("admin");
});

test("로그인할 때마다 SSO 그룹/조직을 최신 claim으로 동기화한다", async () => {
  const id = identity({ groups: ["Platform 조직"] });
  const created = await login({ identity: id, isAdmin: false, autoCreate: true });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  await login({
    identity: { ...id, groups: ["Search 조직", "Glossary Editors"] },
    isAdmin: false,
    autoCreate: true,
  });

  expect((await rowOf(created.user.id)).ssoGroups).toEqual(["Search 조직", "Glossary Editors"]);
});

// 이메일을 따라가려다 users_email_lower_unique를 위반하면 로그인 전체가 500이 된다.
// 이름·역할은 갱신하되 이메일만 두는 편이 낫다.
test("바뀐 이메일을 다른 계정이 이미 쓰고 있으면 이메일만 그대로 둔다", async () => {
  const taken = `${unique("taken")}@example.com`;
  const other = await login({ identity: identity({ email: taken }), isAdmin: false, autoCreate: true });
  expect(other.ok).toBe(true);

  const mine = identity();
  const created = await login({ identity: mine, isAdmin: false, autoCreate: true });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const result = await login({
    identity: { ...mine, email: taken, name: "이름은 바뀐다" },
    isAdmin: false,
    autoCreate: true,
  });

  expect(result.ok).toBe(true);
  const row = await rowOf(created.user.id);
  expect(row.email).toBe(mine.email);
  expect(row.name).toBe("이름은 바뀐다");
  const [dupes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`lower(${users.email}) = ${taken}`);
  expect(dupes!.n).toBe(1);
});
