import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Claims } from "./claims";
import { validateIdTokenClaims } from "./claims";
import type { SsoConfig } from "./config";
import type { SsoProtocol } from "./config";
import { sanitizeSsoValue } from "./diagnostics";

/**
 * R132: 인가 코드 흐름(Authorization Code + PKCE)의 배선. 브라우저를 IdP로 보내고
 * 돌아온 코드를 토큰으로 바꾸는 부분이다.
 *
 * 상태(state/nonce/PKCE 검증자)는 서버 테이블이 아니라 짧은 수명의 HttpOnly 쿠키에
 * 담는다. state 검증은 "쿠키에 든 값과 쿼리로 돌아온 값이 같은가"이므로 별도의
 * 서명 키가 필요 없고(둘 다 우리가 방금 만든 값이다), 로그인이 중간에 버려져도
 * 청소할 행이 남지 않는다.
 */
export const SSO_FLOW_COOKIE = "glossary_sso";
const FLOW_TTL_SECONDS = 600;
// 쿠키를 이 경로에만 보낸다 — /sheet 같은 평범한 요청에 로그인 중간 상태가 실려 다닐 이유가 없다.
const FLOW_COOKIE_PATH = "/auth/sso";

export interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  protocol: SsoProtocol;
  /** 설정 화면에서 시작한 재동기화라면, 다른 IdP 계정으로 바뀌지 않도록 현재 사용자 id를 묶는다. */
  refreshUserId?: string;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** RFC 7636 S256. 검증자는 쿠키에만 있고, IdP에는 그 해시(challenge)만 간다. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encodeFlowState(flow: FlowState): string {
  return Buffer.from(JSON.stringify(flow), "utf8").toString("base64url");
}

export function decodeFlowState(raw: string | undefined | null): FlowState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { state, nonce, verifier, protocol, refreshUserId } = parsed as Record<string, unknown>;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof verifier !== "string") return null;
    if (protocol !== "oidc" && protocol !== "oauth2") return null;
    if (!state || !nonce || !verifier) return null;
    if (refreshUserId !== undefined && (typeof refreshUserId !== "string" || !refreshUserId)) return null;
    return { state, nonce, verifier, protocol, ...(refreshUserId ? { refreshUserId } : {}) };
  } catch {
    return null;
  }
}

/**
 * 쿠키 헤더에서 흐름 상태를 읽는다. next/headers의 cookies() 대신 요청 헤더를 직접
 * 파싱한다 — 이 라우트는 요청 객체 하나만 있으면 완결되므로 테스트가 Next 런타임을
 * 흉내 낼 필요가 없다.
 */
export function readFlowCookie(request: Request): FlowState | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SSO_FLOW_COOKIE) continue;
    return decodeFlowState(part.slice(eq + 1).trim());
  }
  return null;
}

export function flowCookie(flow: FlowState, secure: boolean): string {
  const value = encodeFlowState(flow);
  return `${SSO_FLOW_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=${FLOW_COOKIE_PATH}; Max-Age=${FLOW_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

/** 한 번 쓰면 지운다. 남겨 두면 같은 state로 콜백을 다시 먹일 수 있다(코드 재사용). */
export function clearFlowCookie(): string {
  return `${SSO_FLOW_COOKIE}=; HttpOnly; SameSite=Lax; Path=${FLOW_COOKIE_PATH}; Max-Age=0`;
}

/**
 * redirect_uri는 인가 요청과 토큰 요청에서 **한 글자도 다르면 안 된다**(IdP가 대조한다).
 * 그래서 두 라우트가 같은 함수로 만든다.
 *
 * 프록시 뒤에서는 Host 헤더가 내부 주소일 수 있어 설정값(baseUrl)이 있으면 그걸 먼저
 * 쓰고, 없으면 X-Forwarded-* 를 본다.
 */
export function resolveBaseUrl(request: Request, cfg: Pick<SsoConfig, "baseUrl">): string {
  if (cfg.baseUrl.trim()) return cfg.baseUrl.trim().replace(/\/+$/, "");

  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`.replace(/\/+$/, "");
  }
  return new URL(request.url).origin;
}

export function redirectUriFor(request: Request, cfg: Pick<SsoConfig, "baseUrl">): string {
  return `${resolveBaseUrl(request, cfg)}/auth/sso/callback`;
}

export function buildAuthorizeUrl(
  cfg: Pick<SsoConfig, "protocol" | "authorizationEndpoint" | "clientId" | "scopes">,
  input: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const url = new URL(cfg.authorizationEndpoint);
  // 인가 엔드포인트에 이미 붙어 있는 쿼리(예: Entra의 ?p=정책)를 지우지 않도록
  // searchParams에 덧붙인다.
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  // OIDC만 openid scope와 nonce를 요구한다. OAuth 2.0은 사용자 정보를 access token으로 조회한다.
  const scopes = cfg.protocol === "oidc" && !cfg.scopes.includes("openid") ? ["openid", ...cfg.scopes] : cfg.scopes;
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", input.state);
  if (cfg.protocol === "oidc") url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type TokenResult =
  | { ok: true; idToken: string | null; accessToken: string | null }
  | { ok: false; detail: string };

export async function exchangeCode(
  cfg: Pick<SsoConfig, "protocol" | "tokenEndpoint" | "clientId" | "clientSecret" | "tokenAuthMethod">,
  input: { code: string; redirectUri: string; verifier: string },
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    client_id: cfg.clientId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  // 시크릿을 본문에 싣는 방식(client_secret_post)과 Basic 헤더로 보내는 방식
  // (client_secret_basic)은 IdP마다 갈린다. 한쪽만 지원하는 IdP가 흔해 둘 다 둔다.
  if (cfg.tokenAuthMethod === "client_secret_basic") {
    // RFC 6749 2.3.1: Basic으로 보낼 때는 두 값을 각각 form-urlencode한 뒤 이어 붙인다.
    const raw = `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`;
    headers.authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  } else {
    body.set("client_secret", cfg.clientSecret);
  }

  const res = await fetch(cfg.tokenEndpoint, { method: "POST", headers, body });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok || !payload || typeof payload !== "object") {
    // 본문에는 시크릿이 없다(에러 코드와 설명뿐). 운영자가 원인을 볼 수 있게 그대로 남긴다.
    return { ok: false, detail: `token ${res.status} ${JSON.stringify(sanitizeSsoValue(payload))}` };
  }

  const data = payload as Record<string, unknown>;
  const idToken = typeof data.id_token === "string" && data.id_token ? data.id_token : null;
  const accessToken = typeof data.access_token === "string" && data.access_token ? data.access_token : null;
  if (cfg.protocol === "oidc" && !idToken) {
    return { ok: false, detail: "id_token 없음 — scope에 openid가 포함됐는지 확인하세요." };
  }
  if (cfg.protocol === "oauth2" && !accessToken) {
    return { ok: false, detail: "access_token 없음 — OAuth 2.0 토큰 응답 설정을 확인하세요." };
  }
  return { ok: true, idToken, accessToken };
}

export type UserinfoResult = { ok: true; claims: Claims } | { ok: false; detail: string };

export async function fetchUserinfo(userinfoEndpoint: string, accessToken: string): Promise<UserinfoResult> {
  const res = await fetch(userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, detail: `userinfo ${res.status} ${JSON.stringify(sanitizeSsoValue(payload))}` };
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, detail: `userinfo ${res.status} content-type=${contentType || "없음"}` };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, detail: "userinfo 응답이 JSON 객체가 아닙니다." };
  }
  return { ok: true, claims: payload as Claims };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(uri: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(uri);
  if (cached) return cached;
  if (jwksCache.size >= 8) jwksCache.clear();
  const created = createRemoteJWKSet(new URL(uri), { timeoutDuration: 5000, cooldownDuration: 30000 });
  jwksCache.set(uri, created);
  return created;
}

export type OidcVerification =
  | { ok: true; claims: Claims }
  | { ok: false; reason: "nonce" | "token"; detail: string };

/** JWKS 서명과 표준 claim을 검증한 뒤에만 ID 토큰 payload를 신뢰한다. */
export async function verifyOidcIdToken(
  cfg: Pick<SsoConfig, "issuer" | "jwksUri" | "clientId">,
  idToken: string,
  nonce: string,
): Promise<OidcVerification> {
  try {
    const { payload, protectedHeader } = await jwtVerify(idToken, remoteJwks(cfg.jwksUri), {
      issuer: cfg.issuer,
      audience: cfg.clientId,
      clockTolerance: 5,
    });
    const claims = payload as Claims;
    const validation = validateIdTokenClaims(claims, { issuer: cfg.issuer, clientId: cfg.clientId, nonce });
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason === "nonce" ? "nonce" : "token",
        detail: `ID 토큰 claim 검증 실패: ${validation.reason}; alg=${protectedHeader.alg ?? "없음"}; kid=${protectedHeader.kid ?? "없음"}`,
      };
    }
    return { ok: true, claims };
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.name}${"code" in error ? `(${String((error as { code?: unknown }).code)})` : ""}: ${error.message}`
      : String(error);
    return { ok: false, reason: "token", detail: `ID 토큰 서명/claim 검증 실패: ${detail}` };
  }
}

/**
 * ID 토큰과 userinfo를 합친다. 그룹이 userinfo에만 오는 IdP가 흔해서 둘 다 필요하다.
 *
 * OIDC Core 5.3.2가 요구하는 대로 sub가 같을 때만 합친다. 다르면 그 userinfo는 다른
 * 사람의 것이므로 통째로 버린다 — 그러지 않으면 토큰만 바꿔치기해 다른 사람의 이름과
 * 그룹을 얹을 수 있다.
 */
export function mergeClaims(idClaims: Claims, userinfo: Claims | null): Claims {
  if (!userinfo) return idClaims;
  if (typeof userinfo.sub === "string" && typeof idClaims.sub === "string" && userinfo.sub !== idClaims.sub) {
    return idClaims;
  }
  return { ...idClaims, ...userinfo };
}
