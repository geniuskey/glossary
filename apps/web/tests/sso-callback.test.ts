import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createDb, ssoConfig, users } from "@grossary/db";
import { GET as callbackGet } from "../src/app/auth/sso/callback/route.js";
import { GET as startGet } from "../src/app/auth/sso/start/route.js";
import { loadSsoConfig, SSO_CONFIG_ID, type SsoConfig } from "../src/lib/auth/sso/config.js";
import { flowCookie, SSO_FLOW_COOKIE } from "../src/lib/auth/sso/flow.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";

// 콜백은 브라우저가 오가는 창구라 JSON 에러가 아니라 302로만 답한다. 그래서
// "무엇이 잘못됐는가"는 응답 본문이 아니라 되돌려 보내는 주소(?sso=코드)에 있다 —
// 이 파일이 검사하는 것이 그 계약이다.

const db = createDb(process.env.DATABASE_URL!);
const BASE = "https://glossary.example.com";
const ISSUER = "https://idp.example.com";
const TOKEN_ENDPOINT = "https://idp.example.com/token";
const USERINFO_ENDPOINT = "https://idp.example.com/userinfo";

let original: SsoConfig;
const createdUserIds: string[] = [];

beforeAll(async () => {
  original = await loadSsoConfig();
});

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  await db.update(ssoConfig).set(original).where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

beforeEach(async () => {
  await db
    .update(ssoConfig)
    .set({
      enabled: true,
      baseUrl: BASE,
      issuer: ISSUER,
      authorizationEndpoint: "https://idp.example.com/authorize",
      tokenEndpoint: TOKEN_ENDPOINT,
      userinfoEndpoint: "",
      clientId: "grossary",
      clientSecret: "s3cr3t",
      scopes: ["openid", "profile", "email"],
      subjectClaims: ["sub"],
      emailClaims: ["email"],
      nameClaims: ["name", "displayName"],
      groupClaims: ["groups"],
      allowedGroups: [],
      adminGroups: [],
      autoCreate: true,
      lastClaimKeys: [],
    })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FLOW = { state: "state-token", nonce: "nonce-token", verifier: "verifier-token" };

function idToken(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}

function stubIdp(claims: Record<string, unknown>, userinfo?: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url) === TOKEN_ENDPOINT) {
      const completeClaims = {
        iss: ISSUER,
        aud: "grossary",
        exp: Math.floor(Date.now() / 1000) + 300,
        ...claims,
      };
      return new Response(JSON.stringify({ id_token: idToken(completeClaims), access_token: "at" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url) === USERINFO_ENDPOINT) {
      return new Response(JSON.stringify(userinfo ?? {}), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  });
}

function callbackRequest(query: Record<string, string>, options: { cookie?: boolean } = {}) {
  const url = new URL(`${BASE}/auth/sso/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers();
  if (options.cookie !== false) headers.set("cookie", flowCookie(FLOW, true).split(";")[0]!);
  return new Request(url, { headers });
}

function location(res: Response) {
  return res.headers.get("location") ?? "";
}

async function userByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (row) createdUserIds.push(row.id);
  return row;
}

test("시작 라우트는 IdP로 302하고 흐름 쿠키를 심는다", async () => {
  const res = await startGet(new Request(`${BASE}/auth/sso/start`));

  expect(res.status).toBe(302);
  const url = new URL(location(res));
  expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
  expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/sso/callback`);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`${SSO_FLOW_COOKIE}=`);
  expect(cookie).toContain("HttpOnly");
  // baseUrl이 https니 Secure가 붙어야 한다 — 안 붙으면 평문으로도 실려 나간다.
  expect(cookie).toContain("Secure");
  // 검증자는 쿠키에만 있고 IdP에는 그 해시만 간다.
  expect(url.searchParams.get("code_challenge")).not.toBe("");
  expect(location(res)).not.toContain("code_verifier");
});

test("성공하면 세션 쿠키를 주고 홈으로 보낸다", async () => {
  const email = `callback-ok-${Date.now()}@example.com`;
  stubIdp({ sub: `sub-${Date.now()}`, email, name: "김철수", nonce: FLOW.nonce });

  const res = await callbackGet(callbackRequest({ code: "code-1", state: FLOW.state }));

  expect(res.status).toBe(302);
  expect(location(res)).toBe(`${BASE}/`);
  const cookies = res.headers.getSetCookie();
  expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && c.includes("HttpOnly"))).toBe(true);
  // 흐름 쿠키는 반드시 지운다 — 남으면 같은 state로 콜백을 다시 먹일 수 있다.
  expect(cookies.some((c) => c.startsWith(`${SSO_FLOW_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
  expect(await userByEmail(email)).toBeDefined();
});

test("흐름 쿠키가 없거나 state가 어긋나면 state 오류로 되돌린다", async () => {
  stubIdp({ sub: "sub-x", email: "x@example.com" });

  const noCookie = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }, { cookie: false }));
  const wrongState = await callbackGet(callbackRequest({ code: "c", state: "다른-값" }));
  const noCode = await callbackGet(callbackRequest({ state: FLOW.state }));

  expect(location(noCookie)).toBe(`${BASE}/login?sso=state`);
  expect(location(wrongState)).toBe(`${BASE}/login?sso=state`);
  expect(location(noCode)).toBe(`${BASE}/login?sso=state`);
});

// nonce는 "이 ID 토큰이 방금 이 브라우저가 시작한 요청의 것인가"를 잇는 끈이다.
test("ID 토큰의 nonce가 다르면 로그인시키지 않는다", async () => {
  stubIdp({ sub: "sub-nonce", email: "nonce@example.com", nonce: "남의-nonce" });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=state`);
});

test("ID 토큰에 nonce가 없거나 audience가 다르면 로그인시키지 않는다", async () => {
  stubIdp({ sub: "sub-invalid-token", email: "invalid-token@example.com", aud: "other-client" });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  // nonce 검증이 먼저이며, 없는 nonce는 다른 nonce와 마찬가지로 흐름 오류다.
  expect(location(res)).toBe(`${BASE}/login?sso=state`);
});

test("IdP가 오류를 알려 오면 그 문구를 화면에 옮기지 않는다", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  const res = await callbackGet(
    callbackRequest({ error: "access_denied", error_description: "사용자가 취소함", state: FLOW.state }),
  );

  expect(location(res)).toBe(`${BASE}/login?sso=idp`);
});

test("SSO가 꺼져 있으면 콜백도 받지 않는다", async () => {
  await db.update(ssoConfig).set({ enabled: false }).where(eq(ssoConfig.id, SSO_CONFIG_ID));

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=disabled`);
});

// 매핑이 틀렸을 때가 운영자에게 claim 이름 목록이 가장 필요한 순간이다 —
// 이게 없으면 "이메일을 못 찾았다"만 보이고 IdP가 무슨 이름으로 보냈는지는 알 길이 없다.
test("매핑이 틀리면 IdP가 보낸 claim 이름을 설정에 남긴다", async () => {
  stubIdp({ sub: "sub-1", upn: "kim@example.com", displayName: "김철수", nonce: FLOW.nonce });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=no_email`);
  const cfg = await loadSsoConfig();
  expect(cfg.lastClaimKeys).toEqual(["displayName", "nonce", "sub", "upn"]);
  expect(cfg.lastLoginAt).not.toBeNull();
});

test("허용 그룹에 없으면 계정을 만들지 않고 되돌린다", async () => {
  const email = `not-allowed-${Date.now()}@example.com`;
  await db.update(ssoConfig).set({ allowedGroups: ["glossary-editors"] }).where(eq(ssoConfig.id, SSO_CONFIG_ID));
  stubIdp({ sub: "sub-2", email, groups: ["other"], nonce: FLOW.nonce });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=not_allowed`);
  expect(await userByEmail(email)).toBeUndefined();
});

// 그룹이 userinfo에만 오는 IdP가 흔하다. ID 토큰만 보면 관리자 그룹이 영영 안 걸린다.
test("그룹이 userinfo에만 있어도 관리자로 올린다", async () => {
  const email = `admin-group-${Date.now()}@example.com`;
  await db
    .update(ssoConfig)
    .set({ userinfoEndpoint: USERINFO_ENDPOINT, adminGroups: ["Glossary-Admins"] })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
  stubIdp({ sub: "sub-3", email, nonce: FLOW.nonce }, { sub: "sub-3", groups: ["glossary-admins"] });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/`);
  const row = await userByEmail(email);
  expect(row?.role).toBe("admin");
});

// OIDC Core 5.3.2 — sub가 다른 userinfo는 남의 것이다. 그걸 얹으면 access token만
// 바꿔치기해 남의 그룹으로 관리자가 될 수 있다.
test("userinfo의 sub가 다르면 그 그룹으로 권한을 주지 않는다", async () => {
  const email = `userinfo-mismatch-${Date.now()}@example.com`;
  await db
    .update(ssoConfig)
    .set({ userinfoEndpoint: USERINFO_ENDPOINT, adminGroups: ["glossary-admins"] })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
  stubIdp({ sub: "sub-4", email, nonce: FLOW.nonce }, { sub: "다른-사람", groups: ["glossary-admins"] });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/`);
  const row = await userByEmail(email);
  expect(row?.role).toBe("editor");
});

test("자동 생성이 꺼져 있으면 없는 계정은 만들지 않는다", async () => {
  const email = `no-account-${Date.now()}@example.com`;
  await db.update(ssoConfig).set({ autoCreate: false }).where(eq(ssoConfig.id, SSO_CONFIG_ID));
  stubIdp({ sub: "sub-5", email, nonce: FLOW.nonce });

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=no_account`);
  expect(await userByEmail(email)).toBeUndefined();
});

test("토큰 교환이 실패하면 사유는 로그로만 남기고 token 오류로 되돌린다", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ error: "invalid_client" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );

  const res = await callbackGet(callbackRequest({ code: "c", state: FLOW.state }));

  expect(location(res)).toBe(`${BASE}/login?sso=token`);
  expect(logged).toHaveBeenCalled();
});
