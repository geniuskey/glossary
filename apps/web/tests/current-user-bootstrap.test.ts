import { afterAll, afterEach, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, users } from "@glossary/db";

let currentHeaders = new Headers();
const saveSsoConfigMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, config: {} })));
vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth/setup", () => ({ needsSetup: async () => true }));
vi.mock("@/lib/auth/sso/config", () => ({
  loadSsoConfig: async () => ({ mode: null, enabled: false, protocol: "oidc", allowedGroups: [], adminGroups: [], autoCreate: true }),
  resolveSsoMode: () => "disabled",
  resolveLoginSsoMode: (_config: unknown, setupNeeded: boolean) => setupNeeded ? "oauth2-proxy" : "disabled",
  saveSsoConfig: saveSsoConfigMock,
}));

const { getCurrentUser } = await import("../src/lib/auth/current-user.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const emails: string[] = [];

afterEach(() => {
  currentHeaders = new Headers();
  delete process.env.AUTH_MODE;
  delete process.env.OAUTH2_PROXY_ENABLED;
  delete process.env.INITIAL_ADMIN_EMAIL;
  saveSsoConfigMock.mockClear();
});

afterAll(async () => {
  for (const email of emails) await db.delete(users).where(sql`lower(${users.email}) = ${email}`);
});

test("빈 설치에서는 지정한 회사 이메일만 SSO 최초 관리자로 생성한다", async () => {
  const email = `bootstrap-${Date.now()}@example.com`;
  emails.push(email);
  process.env.OAUTH2_PROXY_ENABLED = "true";
  process.env.INITIAL_ADMIN_EMAIL = email.toUpperCase();
  currentHeaders = new Headers({
    "x-forwarded-email": email,
    "x-forwarded-preferred-username": encodeURIComponent("김관리"),
  });

  await expect(getCurrentUser()).resolves.toMatchObject({ email, name: "김관리", role: "admin" });
  const [saved] = await db.select({ role: users.role }).from(users).where(eq(users.email, email));
  expect(saved?.role).toBe("admin");
  expect(saveSsoConfigMock).toHaveBeenCalledWith({ mode: "oauth2-proxy" }, null);
});

test("빈 설치에서 지정하지 않은 이메일은 계정을 만들지 않는다", async () => {
  const email = `not-bootstrap-${Date.now()}@example.com`;
  emails.push(email);
  process.env.OAUTH2_PROXY_ENABLED = "true";
  process.env.INITIAL_ADMIN_EMAIL = "other@example.com";
  currentHeaders = new Headers({ "x-forwarded-email": email });

  await expect(getCurrentUser()).resolves.toBeNull();
  const [count] = await db.select({ value: sql<number>`count(*)::int` }).from(users).where(eq(users.email, email));
  expect(count?.value).toBe(0);
});
