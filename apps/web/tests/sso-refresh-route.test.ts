import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createDb, ssoConfig, users } from "@glossary/db";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { loadSsoConfig, SSO_CONFIG_ID, type SsoConfig } from "../src/lib/auth/sso/config.js";

let currentCookieValue: string | undefined;
let currentHeaders = new Headers();

vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { POST } = await import("../src/app/api/v1/account/sso-refresh/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
let originalConfig: SsoConfig;

beforeAll(async () => {
  originalConfig = await loadSsoConfig();
  await db
    .update(ssoConfig)
    .set({
      mode: "oidc",
      enabled: true,
      authorizationEndpoint: "https://idp.example.com/authorize",
      clientId: "glossary-test",
      allowedGroups: [],
      adminGroups: [],
      autoCreate: true,
    })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

afterEach(async () => {
  currentCookieValue = undefined;
  currentHeaders = new Headers();
  delete process.env.AUTH_MODE;
  delete process.env.SSO_TRUST_PROXY_HEADERS;
  delete process.env.OAUTH2_PROXY_ENABLED;
  await db.update(ssoConfig).set({ mode: "oidc", enabled: true, protocol: "oidc" }).where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  await db.update(ssoConfig).set(originalConfig).where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

async function makeUser(externalId: string | null = null) {
  const email = `sso-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [user] = await db.insert(users).values({
    email,
    name: "직접 바꾼 이름",
    externalId,
  }).returning();
  createdUserIds.push(user!.id);
  return user!;
}

function request() {
  return new Request("http://localhost:3000/api/v1/account/sso-refresh", { method: "POST" });
}

test("oauth2-proxy 사용자는 현재 헤더의 이름과 그룹을 즉시 다시 가져온다", async () => {
  const user = await makeUser();
  await db.update(ssoConfig).set({ mode: "oauth2-proxy", enabled: false }).where(eq(ssoConfig.id, SSO_CONFIG_ID));
  process.env.OAUTH2_PROXY_ENABLED = "true";
  currentHeaders = new Headers({
    "x-forwarded-email": user.email,
    "x-forwarded-preferred-username": encodeURIComponent("정상 회사 이름"),
    "x-forwarded-groups": encodeURIComponent("개발팀,플랫폼팀"),
  });

  const response = await POST(request());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ refreshed: true, user: { name: "정상 회사 이름" } });
  const [saved] = await db.select().from(users).where(eq(users.id, user.id));
  expect(saved?.name).toBe("정상 회사 이름");
  expect(saved?.ssoGroups).toEqual(["개발팀", "플랫폼팀"]);
});

test("직접 OIDC/OAuth2 사용자는 재인증 시작 주소를 받는다", async () => {
  const subject = `subject-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await makeUser(subject);
  currentCookieValue = (await createSession(user.id)).token;

  const response = await POST(request());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    redirectTo: "/auth/sso/start?refresh=1",
    refreshed: false,
  });
});
