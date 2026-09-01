import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { createDb, sessions, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, hashSessionToken, SESSION_COOKIE } from "../src/lib/auth/session.js";

// getCurrentUser는 next/headers의 cookies()가 실제 요청 컨텍스트 안에서만 동작한다는
// 전제로 만들어졌다. vitest는 그 컨텍스트가 없으므로 next/headers를 모킹해서
// 이 테스트 파일이 제어하는 쿠키값을 반환하게 한다.
let currentCookieValue: string | undefined;
let currentHeaders = new Headers();

vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
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
  currentHeaders = new Headers();
  delete process.env.AUTH_MODE;
  delete process.env.SSO_TRUST_PROXY_HEADERS;
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

test("oauth2-proxy 모드는 이메일 헤더로 기존 계정을 연결하고 첫 그룹을 조직으로 돌려준다", async () => {
  const user = await makeUser();
  process.env.AUTH_MODE = "oauth2-proxy";
  currentHeaders = new Headers({
    "x-forwarded-email": user.email.toUpperCase(),
    "x-forwarded-preferred-username": encodeURIComponent("김의윤"),
    "x-forwarded-groups": encodeURIComponent("보안팀, 개발팀"),
  });

  await expect(getCurrentUser()).resolves.toEqual({
    id: user.id,
    email: user.email,
    name: "김의윤",
    role: user.role,
    organization: "보안팀",
  });

  const [saved] = await db.select().from(users).where(eq(users.id, user.id));
  expect(saved?.externalId).toBe(user.email);
  expect(saved?.ssoGroups).toEqual(["보안팀", "개발팀"]);
});

test("oauth2-proxy 전용 모드는 헤더가 없으면 유효한 로컬 세션으로 우회하지 않는다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);
  currentCookieValue = token;
  process.env.AUTH_MODE = "oauth2-proxy";

  await expect(getCurrentUser()).resolves.toBeNull();
});

test("oidc 혼합 모드는 명시적으로 켠 경우에만 프록시 헤더를 신뢰한다", async () => {
  const user = await makeUser();
  const { token } = await createSession(user.id);
  currentCookieValue = token;
  currentHeaders = new Headers({
    "x-forwarded-email": user.email,
    "x-forwarded-preferred-username": encodeURIComponent("프록시 이름"),
  });
  process.env.AUTH_MODE = "oidc";

  await expect(getCurrentUser()).resolves.toMatchObject({ name: user.name });

  process.env.SSO_TRUST_PROXY_HEADERS = "true";
  await expect(getCurrentUser()).resolves.toMatchObject({ name: "프록시 이름" });
});
