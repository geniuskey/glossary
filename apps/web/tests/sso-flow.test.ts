import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import {
  buildAuthorizeUrl,
  clearFlowCookie,
  decodeFlowState,
  encodeFlowState,
  exchangeCode,
  flowCookie,
  mergeClaims,
  pkceChallenge,
  randomToken,
  readFlowCookie,
  redirectUriFor,
  resolveBaseUrl,
  SSO_FLOW_COOKIE,
} from "../src/lib/auth/sso/flow.js";

const CFG = {
  protocol: "oidc" as const,
  authorizationEndpoint: "https://idp.example.com/authorize?p=b2c_1_signin",
  tokenEndpoint: "https://idp.example.com/token",
  clientId: "glossary",
  clientSecret: "s3cr3t",
  tokenAuthMethod: "client_secret_post",
  scopes: ["profile", "email"],
  baseUrl: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("PKCE 챌린지는 검증자의 SHA-256(base64url)이다", () => {
  const verifier = randomToken();

  expect(pkceChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  // base64url이 아니면 IdP가 그대로 URL에 실린 +/= 때문에 거절한다.
  expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("흐름 상태는 쿠키 헤더에서 그대로 되살아난다", () => {
  const flow = { state: "st", nonce: "no", verifier: "ve", protocol: "oidc" as const };
  const request = new Request("http://localhost:3000/auth/sso/callback", {
    headers: { cookie: `theme=dark; ${flowCookie(flow, false).split(";")[0]}` },
  });

  expect(readFlowCookie(request)).toEqual(flow);
  expect(decodeFlowState(encodeFlowState(flow))).toEqual(flow);
  expect(decodeFlowState(encodeFlowState({ ...flow, nonce: "" }))).toBeNull();
  expect(decodeFlowState("not-base64url-json")).toBeNull();
  expect(decodeFlowState(undefined)).toBeNull();
});

test("SSO 정보 재동기화 흐름은 현재 사용자 id를 콜백까지 보존한다", () => {
  const flow = {
    state: "st",
    nonce: "no",
    verifier: "ve",
    protocol: "oidc" as const,
    refreshUserId: "user-id",
  };

  expect(decodeFlowState(encodeFlowState(flow))).toEqual(flow);
  expect(decodeFlowState(encodeFlowState({ ...flow, refreshUserId: "" }))).toBeNull();
});

// 쿠키가 남아 있으면 같은 state로 콜백을 다시 먹일 수 있다(코드 재사용).
test("흐름 쿠키는 HttpOnly이고 지울 때 Max-Age=0이다", () => {
  const cookie = flowCookie({ state: "st", nonce: "no", verifier: "ve", protocol: "oidc" }, true);

  expect(cookie).toContain(`${SSO_FLOW_COOKIE}=`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Secure");
  expect(clearFlowCookie()).toContain("Max-Age=0");
  expect(flowCookie({ state: "st", nonce: "no", verifier: "ve", protocol: "oidc" }, false)).not.toContain("Secure");
});

// 프록시 뒤에서는 Host가 내부 주소다. redirect_uri가 인가 요청과 토큰 요청에서
// 한 글자라도 다르면 IdP가 거절하므로 두 라우트가 같은 함수로 만든다.
test("외부 주소는 설정값 → X-Forwarded-* → 요청 origin 순으로 정해진다", () => {
  const plain = new Request("http://localhost:3000/auth/sso/start", { headers: { host: "localhost:3000" } });
  expect(resolveBaseUrl(plain, { baseUrl: "" })).toBe("http://localhost:3000");

  const proxied = new Request("http://internal:3000/auth/sso/start", {
    headers: { "x-forwarded-host": "glossary.example.com", "x-forwarded-proto": "https, http" },
  });
  expect(resolveBaseUrl(proxied, { baseUrl: "" })).toBe("https://glossary.example.com");

  expect(resolveBaseUrl(proxied, { baseUrl: "https://fixed.example.com/" })).toBe("https://fixed.example.com");
  expect(redirectUriFor(proxied, { baseUrl: "" })).toBe("https://glossary.example.com/auth/sso/callback");
});

test("인가 URL은 엔드포인트에 이미 붙은 쿼리를 지우지 않는다", () => {
  const url = new URL(
    buildAuthorizeUrl(CFG, {
      redirectUri: "https://glossary.example.com/auth/sso/callback",
      state: "st",
      nonce: "no",
      challenge: "ch",
    }),
  );

  // Entra의 ?p=<정책> 같은 값이 사라지면 로그인 화면 자체가 뜨지 않는다.
  expect(url.searchParams.get("p")).toBe("b2c_1_signin");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toBe("https://glossary.example.com/auth/sso/callback");
  // openid가 빠지면 ID 토큰이 오지 않아 sub를 읽을 곳이 없다.
  expect(url.searchParams.get("scope")).toBe("openid profile email");
});

test("scope에 openid가 이미 있으면 중복해서 넣지 않는다", () => {
  const url = new URL(
    buildAuthorizeUrl(
      { ...CFG, scopes: ["openid", "email"] },
      { redirectUri: "https://x/cb", state: "s", nonce: "n", challenge: "c" },
    ),
  );

  expect(url.searchParams.get("scope")).toBe("openid email");
});

test("OAuth 2.0 인가 요청은 openid와 nonce를 강제로 넣지 않는다", () => {
  const url = new URL(
    buildAuthorizeUrl(
      { ...CFG, protocol: "oauth2", scopes: ["profile", "email"] },
      { redirectUri: "https://x/cb", state: "s", nonce: "n", challenge: "c" },
    ),
  );

  expect(url.searchParams.get("scope")).toBe("profile email");
  expect(url.searchParams.has("nonce")).toBe(false);
});

test("토큰 교환은 코드 검증자를 함께 보내고 id_token을 돌려준다", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id_token: "a.b.c", access_token: "at" }), {
      headers: { "content-type": "application/json" },
    });
  });

  const result = await exchangeCode(CFG, { code: "code-1", redirectUri: "https://x/cb", verifier: "ve" });

  expect(result).toEqual({ ok: true, idToken: "a.b.c", accessToken: "at" });
  const body = new URLSearchParams(String(calls[0]!.init.body));
  expect(body.get("code_verifier")).toBe("ve");
  expect(body.get("client_secret")).toBe("s3cr3t");
  expect(body.get("grant_type")).toBe("authorization_code");
});

// 시크릿을 본문에만 받는 IdP와 Basic 헤더로만 받는 IdP가 둘 다 흔하다.
test("client_secret_basic이면 시크릿이 본문이 아니라 Authorization에 실린다", async () => {
  let seen: { headers: Record<string, string>; body: string } | null = null;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    seen = { headers: init.headers as Record<string, string>, body: String(init.body) };
    return new Response(JSON.stringify({ id_token: "a.b.c" }), { headers: { "content-type": "application/json" } });
  });

  await exchangeCode(
    { ...CFG, tokenAuthMethod: "client_secret_basic" },
    { code: "c", redirectUri: "https://x/cb", verifier: "v" },
  );

  const captured = seen as unknown as { headers: Record<string, string>; body: string };
  expect(captured.headers.authorization).toBe(`Basic ${Buffer.from("glossary:s3cr3t", "utf8").toString("base64")}`);
  expect(new URLSearchParams(captured.body).get("client_secret")).toBeNull();
});

test("id_token이 없으면 실패로 보고 이유를 남긴다", async () => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ access_token: "at" }), { headers: { "content-type": "application/json" } }),
  );

  const result = await exchangeCode(CFG, { code: "c", redirectUri: "https://x/cb", verifier: "v" });

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.detail).toContain("openid");
});

test("OAuth 2.0 토큰 교환은 access_token만 있어도 성공한다", async () => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ access_token: "at" }), { headers: { "content-type": "application/json" } }),
  );

  await expect(exchangeCode(
    { ...CFG, protocol: "oauth2" },
    { code: "c", redirectUri: "https://x/cb", verifier: "v" },
  )).resolves.toEqual({ ok: true, idToken: null, accessToken: "at" });
});

// OIDC Core 5.3.2. 이걸 지키지 않으면 access token만 바꿔치기해 남의 이름과 그룹을 얹을 수 있다.
test("userinfo의 sub가 ID 토큰과 다르면 통째로 버린다", () => {
  const idClaims = { sub: "user-1", email: "kim@example.com" };

  expect(mergeClaims(idClaims, { sub: "user-2", groups: ["admin"] })).toEqual(idClaims);
  expect(mergeClaims(idClaims, { sub: "user-1", groups: ["editors"] })).toEqual({ ...idClaims, groups: ["editors"] });
  expect(mergeClaims(idClaims, null)).toEqual(idClaims);
});
