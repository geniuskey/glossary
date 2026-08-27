import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { createDb, sessions, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, hashSessionToken, SESSION_COOKIE } from "../src/lib/auth/session.js";

// getCurrentUser는 next/headers의 cookies()가 실제 요청 컨텍스트 안에서만 동작한다는
// 전제로 만들어졌다. vitest는 그 컨텍스트가 없으므로 next/headers를 모킹해서
// 이 테스트 파일이 제어하는 쿠키값을 반환하게 한다.
let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { getCurrentUser } = await import("../src/lib/auth/current-user.js");

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({
      email: `current-user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "현재 사용자 테스트",
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  createdUserIds.push(row!.id);
  return row!;
}

afterEach(() => {
  currentCookieValue = undefined;
});

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

test("유효한 세션이면 사용자 정보를 반환한다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);
  currentCookieValue = token;

  await expect(getCurrentUser()).resolves.toEqual({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});

test("만료된 세션이면 null을 반환한다", async () => {
  const user = await makeUser();
  const token = `expired-${Math.random().toString(36).slice(2)}`;
  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() - 1000),
  });
  currentCookieValue = token;

  await expect(getCurrentUser()).resolves.toBeNull();
});

test("쿠키가 없으면 null을 반환한다", async () => {
  currentCookieValue = undefined;
  await expect(getCurrentUser()).resolves.toBeNull();
});

test("DB에 저장된 해시값을 쿠키에 그대로 넣어도 인증되지 않는다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);
  currentCookieValue = hashSessionToken(token); // 해시값 자체를 토큰인 척 제출

  await expect(getCurrentUser()).resolves.toBeNull();
});
