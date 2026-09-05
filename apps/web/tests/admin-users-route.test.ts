import { eq } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { createDb, sessions, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: listUsers } = await import("../src/app/api/v1/admin/users/route.js");
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
