import { afterAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, users } from "@glossary/db";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

let sessionToken: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && sessionToken ? { name, value: sessionToken } : undefined,
  }),
}));

const { PATCH } = await import("../src/app/api/v1/account/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
let userId = "";

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

function request(name: unknown) {
  return new Request("http://x/api/v1/account", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

test("사용자는 자신의 표시 이름을 변경할 수 있다", async () => {
  const [user] = await db.insert(users).values({
    email: `account-${Date.now()}@example.com`,
    name: "깨진 이름",
  }).returning();
  userId = user!.id;
  sessionToken = (await createSession(userId)).token;

  const response = await PATCH(request("김의윤"));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ user: { id: userId, name: "김의윤" } });
  const [saved] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  expect(saved?.name).toBe("김의윤");
});

test("빈 이름과 로그인하지 않은 요청은 거절한다", async () => {
  expect((await PATCH(request("  "))).status).toBe(400);
  sessionToken = undefined;
  expect((await PATCH(request("누군가"))).status).toBe(401);
});
