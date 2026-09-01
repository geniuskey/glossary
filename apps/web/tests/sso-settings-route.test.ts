import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createDb, ssoConfig, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";

// revert-route.test.ts와 같은 이유 — 인증을 통째로 지워도 그린으로 남지 않도록
// 라우트 함수를 직접 두들긴다. 세션 쿠키만 next/headers로 흉내 낸다.
let currentCookieValue: string | undefined;
let currentHeaders = new Headers();

vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: ssoGet, PUT: ssoPut } = await import("../src/app/api/v1/sso/route.js");
const { POST: discoverPost } = await import("../src/app/api/v1/sso/discover/route.js");
const { GET: proxyCheckGet } = await import("../src/app/api/v1/sso/proxy-check/route.js");
const { loadSsoConfig, SSO_CONFIG_ID } = await import("../src/lib/auth/sso/config.js");

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];
let original: Awaited<ReturnType<typeof loadSsoConfig>>;

beforeAll(async () => {
  original = await loadSsoConfig();
});

afterEach(() => {
  currentCookieValue = undefined;
  currentHeaders = new Headers();
  delete process.env.AUTH_MODE;
  delete process.env.SSO_TRUST_PROXY_HEADERS;
});

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  await db.update(ssoConfig).set(original).where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

async function loginAs(role: "admin" | "editor") {
  const [row] = await db
    .insert(users)
    .values({
      email: `sso-route-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `SSO 라우트 ${role}`,
      passwordHash: await hashPassword("irrelevant"),
      role,
    })
    .returning();
  createdUserIds.push(row!.id);
  const session = await createSession(row!.id);
  currentCookieValue = session.token;
  return row!;
}

function getRequest() {
  return new Request("https://glossary.example.com/api/v1/sso", {
    headers: { "x-forwarded-host": "glossary.example.com", "x-forwarded-proto": "https" },
  });
}

function putRequest(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/sso", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("로그인하지 않으면 401, 편집자면 403이다", async () => {
  currentCookieValue = undefined;
  const anonymous = await ssoGet(getRequest());
  expect(anonymous.status).toBe(401);
  expect((await anonymous.json()).error.code).toBe("unauthorized");

  await loginAs("editor");
  const editor = await ssoGet(getRequest());
  expect(editor.status).toBe(403);
  expect((await editor.json()).error.code).toBe("forbidden");

  const editorWrite = await ssoPut(putRequest({ enabled: false }));
  expect(editorWrite.status).toBe(403);
  const editorDiscover = await discoverPost(
    new Request("https://x/api/v1/sso/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issuer: "https://idp.example.com" }),
    }),
  );
  // SSRF 창구라 편집자에게도 열지 않는다.
  expect(editorDiscover.status).toBe(403);
});

test("관리자에게도 시크릿은 돌려주지 않고, 등록할 리디렉션 URI를 함께 준다", async () => {
  await db.update(ssoConfig).set({ clientSecret: "s3cr3t", baseUrl: "" }).where(eq(ssoConfig.id, SSO_CONFIG_ID));
  await loginAs("admin");

  const res = await ssoGet(getRequest());

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.sso.clientSecret).toBeUndefined();
  expect(body.sso.hasClientSecret).toBe(true);
  // 이 주소는 인가·토큰 요청에 실리는 값과 같은 함수가 만든다(한 글자만 달라도 IdP가 거절한다).
  expect(body.redirectUri).toBe("https://glossary.example.com/auth/sso/callback");
});

test("관리자는 로그인 방식과 claim 매핑을 저장할 수 있다", async () => {
  await loginAs("admin");

  const res = await ssoPut(
    putRequest({
      protocol: "oauth2",
      issuer: "",
      jwksUri: "",
      userinfoEndpoint: "https://idp.example.com/userinfo",
      scopes: ["profile", "email"],
      nameClaims: ["displayName", "name", "preferred_username"],
      groupClaims: ["roles"],
      clientSecret: "",
    }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.sso.protocol).toBe("oauth2");
  expect(body.sso.nameClaims).toEqual(["displayName", "name", "preferred_username"]);
  expect((await loadSsoConfig()).groupClaims).toEqual(["roles"]);
});

// 서버가 채우는 값(lastClaimKeys/updatedBy)이 본문으로 들어와 덮어써지면 운영자가
// 보는 "IdP가 실제로 보낸 이름"이 거짓말이 된다.
test("서버가 채우는 필드는 본문으로 받지 않는다", async () => {
  await loginAs("admin");

  const res = await ssoPut(putRequest({ lastClaimKeys: ["거짓"], updatedBy: null }));

  expect(res.status).toBe(400);
  expect((await res.json()).error.code).toBe("validation_failed");
});

test("엔드포인트는 http(s)만 받는다", async () => {
  await loginAs("admin");

  const res = await ssoPut(putRequest({ tokenEndpoint: "file:///etc/passwd" }));

  expect(res.status).toBe(400);
});

// 빈 설정으로 켜면 로그인 화면에 버튼이 생기고, 누른 사람이 대신 실패를 본다.
test("갖춰지지 않은 채 켜려 하면 무엇이 빠졌는지 돌려준다", async () => {
  await db
    .update(ssoConfig)
    .set({ enabled: false, clientId: "", clientSecret: "", authorizationEndpoint: "", tokenEndpoint: "" })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
  await loginAs("admin");

  const res = await ssoPut(putRequest({ enabled: true }));

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.details.problems.length).toBeGreaterThan(0);
  expect((await loadSsoConfig()).enabled).toBe(false);
});

test("발견 문서를 읽어 엔드포인트를 돌려준다", async () => {
  await loginAs("admin");
  vi.stubGlobal("fetch", async (url: string) => {
    expect(String(url)).toBe("https://idp.example.com/.well-known/openid-configuration");
    return new Response(
      JSON.stringify({
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
        claims_supported: ["sub", "email", "preferred_username"],
      }),
      { headers: { "content-type": "application/json" } },
    );
  });

  const res = await discoverPost(
    new Request("https://x/api/v1/sso/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issuer: "https://idp.example.com/" }),
    }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.discovery.tokenEndpoint).toBe("https://idp.example.com/token");
  expect(body.discovery.jwksUri).toBe("https://idp.example.com/jwks");
  // 이 목록이 곧 설정 화면의 "고를 수 있는 claim 이름" 힌트가 된다.
  expect(body.discovery.claimsSupported).toContain("preferred_username");
  vi.unstubAllGlobals();
});

test("관리자 연결 확인은 그 요청에 도착한 oauth2-proxy 헤더를 그대로 진단한다", async () => {
  const admin = await loginAs("admin");
  process.env.AUTH_MODE = "oauth2-proxy";
  currentHeaders = new Headers({
    "x-forwarded-email": admin.email,
    "x-forwarded-preferred-username": encodeURIComponent("김의윤"),
    "x-forwarded-groups": encodeURIComponent("보안팀,플랫폼팀"),
  });
  const request = new Request("https://x/api/v1/sso/proxy-check", { headers: currentHeaders });

  const res = await proxyCheckGet(request);

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.proxyHeaders).toMatchObject({
    authMode: "oauth2-proxy",
    trusted: true,
    detected: true,
    identity: {
      email: admin.email,
      name: "김의윤",
      groups: ["보안팀", "플랫폼팀"],
      organization: "보안팀",
    },
  });
});
