import { eq } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { createDb, sessions, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: listUsers, PATCH: patchUsers } = await import("../src/app/api/v1/admin/users/route.js");
const { PATCH: patchUser } = await import("../src/app/api/v1/admin/users/[id]/route.js");
const { DELETE: deleteSessions } = await import("../src/app/api/v1/admin/users/[id]/sessions/route.js");

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function createUser(role: "admin" | "editor", label: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `admin-users-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `관리 대상 ${label}`,
      passwordHash: await hashPassword("irrelevant-password"),
      role,
    })
    .returning();
  createdUserIds.push(user!.id);
  return user!;
}

async function createAgent(label: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `agent+${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@agents.invalid`, name: `에이전트 ${label}`, role: "editor" })
    .returning();
  createdUserIds.push(user!.id);
  return user!;
}

function bulkRequest(body: Record<string, unknown>) {
  return new Request("https://glossary.example.com/api/v1/admin/users", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function roleOf(id: string) {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
  return row?.role;
}

async function loginAs(role: "admin" | "editor", label: string) {
  const user = await createUser(role, label);
  const session = await createSession(user.id);
  currentCookieValue = session.token;
  return user;
}

function patchRequest(role: "admin" | "editor", extra: Record<string, unknown> = {}) {
  return new Request("https://glossary.example.com/api/v1/admin/users/id", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, ...extra }),
  });
}

test("사용자 관리 API는 비로그인·편집자 접근을 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await listUsers()).status).toBe(401);

  const editor = await loginAs("editor", "editor-guard");
  expect((await listUsers()).status).toBe(403);
  expect((await patchUser(patchRequest("admin"), { params: Promise.resolve({ id: editor.id }) })).status).toBe(403);
  expect((await deleteSessions(new Request("https://glossary.example.com", { method: "DELETE" }), {
    params: Promise.resolve({ id: editor.id }),
  })).status).toBe(403);
});

test("관리자는 사용자 목록에서 비밀값 없이 계정 유형과 활성 세션 수를 본다", async () => {
  await loginAs("admin", "list-admin");
  const target = await createUser("editor", "list-target");
  await createSession(target.id);

  const res = await listUsers();
  expect(res.status).toBe(200);
  const body = await res.json();
  const row = body.users.find((user: { id: string }) => user.id === target.id);
  expect(row).toMatchObject({ role: "editor", authType: "password", activeSessions: 1 });
  expect(row.passwordHash).toBeUndefined();
  expect(row.externalId).toBeUndefined();
});

test("관리자는 다른 사용자의 역할을 바꾸지만 자기 역할은 내릴 수 없다", async () => {
  const admin = await loginAs("admin", "role-admin");
  const target = await createUser("editor", "role-target");

  const promoted = await patchUser(patchRequest("admin"), { params: Promise.resolve({ id: target.id }) });
  expect(promoted.status).toBe(200);
  const [promotedRow] = await db.select({ role: users.role }).from(users).where(eq(users.id, target.id));
  expect(promotedRow?.role).toBe("admin");

  const selfDemotion = await patchUser(patchRequest("editor"), { params: Promise.resolve({ id: admin.id }) });
  expect(selfDemotion.status).toBe(409);
  expect((await selfDemotion.json()).error.code).toBe("operation_conflict");
  const [adminRow] = await db.select({ role: users.role }).from(users).where(eq(users.id, admin.id));
  expect(adminRow?.role).toBe("admin");
});

test("역할 변경 본문은 알 수 없는 필드를 받지 않고, 잘못된 id는 404다", async () => {
  await loginAs("admin", "validation-admin");
  const target = await createUser("editor", "validation-target");

  const extra = await patchUser(patchRequest("admin", { email: "takeover@example.com" }), {
    params: Promise.resolve({ id: target.id }),
  });
  expect(extra.status).toBe(400);

  const malformed = await patchUser(patchRequest("admin"), { params: Promise.resolve({ id: "not-a-uuid" }) });
  expect(malformed.status).toBe(404);
});

test("관리자는 다른 사용자의 모든 세션을 종료하지만 자기 세션은 종료할 수 없다", async () => {
  const admin = await loginAs("admin", "sessions-admin");
  const target = await createUser("editor", "sessions-target");
  await createSession(target.id);
  await createSession(target.id);

  const res = await deleteSessions(new Request("https://glossary.example.com", { method: "DELETE" }), {
    params: Promise.resolve({ id: target.id }),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).revoked).toBe(2);
  expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);

  const self = await deleteSessions(new Request("https://glossary.example.com", { method: "DELETE" }), {
    params: Promise.resolve({ id: admin.id }),
  });
  expect(self.status).toBe(409);
});

test("관리자 목록은 SSO 그룹의 첫 값을 조직으로 보여준다", async () => {
  await loginAs("admin", "org-admin");
  const target = await createUser("editor", "org-target");
  await db.update(users).set({ ssoGroups: ["센서개발팀", "glossary-editors"] }).where(eq(users.id, target.id));

  const body = await (await listUsers()).json();
  const rows = body.users as { id: string; organization: string | null }[];
  expect(rows.find((user) => user.id === target.id)?.organization).toBe("센서개발팀");
  expect(rows.every((user) => "organization" in user)).toBe(true);
});

test("여러 명의 역할을 한 번에 바꾸고, 실제로 바뀐 사람만 돌려준다", async () => {
  await loginAs("admin", "bulk-admin");
  const a = await createUser("editor", "bulk-a");
  const b = await createUser("editor", "bulk-b");
  await db.update(users).set({ role: "viewer" }).where(eq(users.id, b.id));

  const res = await patchUsers(bulkRequest({ ids: [a.id, b.id], role: "viewer" }));
  expect(res.status).toBe(200);
  expect((await res.json()).changed).toEqual([a.id]);
  expect(await roleOf(a.id)).toBe("viewer");
  expect(await roleOf(b.id)).toBe("viewer");
});

// 일부만 반영되면 관리자가 화면과 DB가 어디서 갈렸는지 다시 맞춰 봐야 한다.
test("일괄 변경은 하나라도 걸리면 아무도 바꾸지 않는다", async () => {
  const admin = await loginAs("admin", "bulk-atomic-admin");
  const target = await createUser("editor", "bulk-atomic-target");
  const agent = await createAgent("bulk-atomic");

  const withSelf = await patchUsers(bulkRequest({ ids: [target.id, admin.id], role: "viewer" }));
  expect(withSelf.status).toBe(409);
  expect(await roleOf(target.id)).toBe("editor");
  expect(await roleOf(admin.id)).toBe("admin");

  const withAgent = await patchUsers(bulkRequest({ ids: [target.id, agent.id], role: "admin" }));
  expect(withAgent.status).toBe(409);
  expect(await roleOf(target.id)).toBe("editor");
  expect(await roleOf(agent.id)).toBe("editor");

  const missing = await patchUsers(bulkRequest({ ids: [target.id, "00000000-0000-4000-8000-000000000000"], role: "viewer" }));
  expect(missing.status).toBe(404);
  expect(await roleOf(target.id)).toBe("editor");
});

test("일괄 변경 본문은 빈 목록·잘못된 id·알 수 없는 필드를 받지 않고, 편집자는 쓸 수 없다", async () => {
  await loginAs("admin", "bulk-validation-admin");
  const target = await createUser("editor", "bulk-validation-target");
  expect((await patchUsers(bulkRequest({ ids: [], role: "viewer" }))).status).toBe(400);
  expect((await patchUsers(bulkRequest({ ids: ["nope"], role: "viewer" }))).status).toBe(400);
  expect((await patchUsers(bulkRequest({ ids: [target.id], role: "viewer", email: "x@example.com" }))).status).toBe(400);

  await loginAs("editor", "bulk-editor");
  expect((await patchUsers(bulkRequest({ ids: [target.id], role: "viewer" }))).status).toBe(403);
  expect(await roleOf(target.id)).toBe("editor");
});
