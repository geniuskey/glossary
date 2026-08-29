import { timingSafeEqual } from "node:crypto";
import { methodStubs } from "@/lib/api-error";
import { claimKeys, decideAccess, decodeJwtPayload, resolveIdentity } from "@/lib/auth/sso/claims";
import { loadSsoConfig, recordClaimKeys } from "@/lib/auth/sso/config";
import type { SsoErrorCode } from "@/lib/auth/sso/errors";
import {
  clearFlowCookie,
  exchangeCode,
  fetchUserinfo,
  mergeClaims,
  readFlowCookie,
  redirectUriFor,
  resolveBaseUrl,
} from "@/lib/auth/sso/flow";
import { applySsoLogin } from "@/lib/auth/sso/login";
import { createSession, purgeExpiredSessions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

// start/route.ts와 같은 이유로 /api/v1 밖에 있고, 에러 응답 대신 302로만 답한다.
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

/** state 비교는 길이가 같을 때만 의미가 있으므로 길이를 먼저 본다(timingSafeEqual은 길이가 다르면 던진다). */
function sameToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function back(base: string, code: SsoErrorCode): Response {
  const headers = new Headers({ location: `${base}/login?sso=${code}` });
  // 실패한 흐름의 쿠키는 반드시 지운다 — 남겨 두면 같은 state로 콜백을 다시 먹일 수 있다.
  headers.append("set-cookie", clearFlowCookie());
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let base = url.origin;

  try {
    const cfg = await loadSsoConfig();
    base = resolveBaseUrl(request, cfg);
    if (!cfg.enabled) return back(base, "disabled");

    // IdP가 거절/취소를 알려 온 경우다. 사유는 로그로만 남긴다(사용자 화면에 IdP 문구를 그대로 옮기지 않는다).
    const idpError = url.searchParams.get("error");
    if (idpError) {
      console.error(`SSO: IdP 오류 ${idpError} ${url.searchParams.get("error_description") ?? ""}`);
      return back(base, "idp");
    }

    const flow = readFlowCookie(request);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    // 쿠키가 없다는 것은 다른 브라우저·다른 탭에서 시작했거나 10분이 지났다는 뜻이다.
    // state가 어긋나면 남이 시작한 로그인을 이 브라우저에 심으려는 시도일 수 있다.
    if (!flow || !state || !sameToken(flow.state, state) || !code) return back(base, "state");

    const token = await exchangeCode(cfg, {
      code,
      redirectUri: redirectUriFor(request, cfg),
      verifier: flow.verifier,
    });
    if (!token.ok) {
      console.error(`SSO: 토큰 교환 실패 — ${token.detail}`);
      return back(base, "token");
    }

    const idClaims = decodeJwtPayload(token.idToken);
    if (!idClaims) return back(base, "token");
    // nonce는 "이 ID 토큰이 방금 이 브라우저가 시작한 요청의 것인가"를 잇는 끈이다.
    if (typeof idClaims.nonce === "string" && !sameToken(idClaims.nonce, flow.nonce)) return back(base, "state");

    const userinfo =
      cfg.userinfoEndpoint && token.accessToken ? await fetchUserinfo(cfg.userinfoEndpoint, token.accessToken) : null;
    const claims = mergeClaims(idClaims, userinfo);

    const identity = resolveIdentity(claims, cfg);
    if (!identity.ok) {
      // 매핑이 틀렸을 때가 운영자에게 claim 이름 목록이 가장 필요한 순간이다.
      await recordClaimKeys(claimKeys(claims));
      return back(base, identity.reason);
    }

    const access = decideAccess({
      groups: identity.identity.groups,
      allowedGroups: cfg.allowedGroups,
      adminGroups: cfg.adminGroups,
    });
    if (!access.allowed) return back(base, "not_allowed");

    const result = await applySsoLogin({
      identity: identity.identity,
      isAdmin: access.isAdmin,
      autoCreate: cfg.autoCreate,
    });
    if (!result.ok) return back(base, result.reason);

    await recordClaimKeys(claimKeys(claims));
    await purgeExpiredSessions();
    const session = await createSession(result.user.id);

    const headers = new Headers({ location: `${base}/terms` });
    headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Expires=${session.expiresAt.toUTCString()}`,
    );
    headers.append("set-cookie", clearFlowCookie());
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error(err);
    return back(base, "server");
  }
}
