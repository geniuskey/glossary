import { eq } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { createDb, sessions, users } from "@glossary/db";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  hashSessionToken,
  isSecureRequest,
  sessionCookie,
} from "../src/lib/auth/session.js";
import { hashPassword } from "../src/lib/auth/password.js";

test("HTTPS 세션 쿠키는 Secure이고 HTTP 개발 쿠키는 Secure가 아니다", () => {
  const expiresAt = new Date("2026-09-01T00:00:00.000Z");

  expect(sessionCookie("token", expiresAt, true)).toContain("; Secure");
  expect(sessionCookie("token", expiresAt, false)).not.toContain("; Secure");
  expect(clearSessionCookie(true)).toContain("; Secure");
});

test("프록시가 전달한 원래 프로토콜을 세션 쿠키 보안 판단에 사용한다", () => {
  expect(isSecureRequest(new Request("https://example.com/login"))).toBe(true);
  expect(isSecureRequest(new Request("http://localhost/login"))).toBe(false);
  expect(
    isSecureRequest(new Request("http://app.internal/login", { headers: { "x-forwarded-proto": "https" } })),
  ).toBe(true);
});

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({
      email: `session-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "세션 테스트",
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  createdUserIds.push(row!.id);
  return row!;
}

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

test("쿠키에 담는 토큰 원문은 DB에 남지 않는다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);

  const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));

  expect(rows).toHaveLength(1);
  expect(rows[0]!.id).not.toBe(token);
  expect(rows[0]!.id).toBe(hashSessionToken(token));
});

test("토큰 원문으로 세션을 지운다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);

  await deleteSession(token);

  const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
  expect(rows).toHaveLength(0);
});
