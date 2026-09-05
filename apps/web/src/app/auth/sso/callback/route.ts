import { timingSafeEqual } from "node:crypto";
import { methodStubs } from "@/lib/api-error";
import { claimKeys, decideAccess, resolveIdentity, type Claims } from "@/lib/auth/sso/claims";
import { loadSsoConfig, recordClaimKeys, resolveSsoMode } from "@/lib/auth/sso/config";
import { logSsoFailure } from "@/lib/auth/sso/diagnostics";
import type { SsoErrorCode } from "@/lib/auth/sso/errors";
import {
  clearFlowCookie,
  exchangeCode,
  fetchUserinfo,
  mergeClaims,
  readFlowCookie,
  redirectUriFor,
  resolveBaseUrl,
  verifyOidcIdToken,
} from "@/lib/auth/sso/flow";
import { applySsoLogin } from "@/lib/auth/sso/login";
import { isInitialAdminEmail } from "@/lib/auth/policy";
import { oauth2SubjectClaims } from "@/lib/auth/sso/proxy-headers";
import { createSession, purgeExpiredSessions, sessionCookie } from "@/lib/auth/session";

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

function back(base: string, code: SsoErrorCode, refresh: boolean): Response {
  const location = refresh
    ? `${base}/settings?ssoRefresh=${code}`
    : `${base}/login?sso=${code}`;
  const headers = new Headers({ location });
  // 실패한 흐름의 쿠키는 반드시 지운다 — 남겨 두면 같은 state로 콜백을 다시 먹일 수 있다.
  headers.append("set-cookie", clearFlowCookie());
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const flow = readFlowCookie(request);
  const refresh = Boolean(flow?.refreshUserId);
  let base = url.origin;

  try {
    const cfg = await loadSsoConfig();
    base = resolveBaseUrl(request, cfg);
    if (resolveSsoMode(cfg) !== cfg.protocol) return back(base, "disabled", refresh);

    // IdP가 거절/취소를 알려 온 경우다. 사유는 로그로만 남긴다(사용자 화면에 IdP 문구를 그대로 옮기지 않는다).
    const idpError = url.searchParams.get("error");
    if (idpError) {
      logSsoFailure("authorization_response", {
        protocol: cfg.protocol,
        providerError: idpError,
        providerDescription: url.searchParams.get("error_description") ?? "",
        providerErrorUri: url.searchParams.get("error_uri") ?? "",
      });
      return back(base, "idp", refresh);
    }

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    // 쿠키가 없다는 것은 다른 브라우저·다른 탭에서 시작했거나 10분이 지났다는 뜻이다.
    // state가 어긋나면 남이 시작한 로그인을 이 브라우저에 심으려는 시도일 수 있다.
    if (!flow || !state || !sameToken(flow.state, state) || !code || flow.protocol !== cfg.protocol) {
      logSsoFailure("flow_validation", {
        protocol: cfg.protocol,
        hasFlowCookie: Boolean(flow),
        hasState: Boolean(state),
        stateMatches: Boolean(flow && state && sameToken(flow.state, state)),
        hasAuthorizationCode: Boolean(code),
        protocolMatches: Boolean(flow && flow.protocol === cfg.protocol),
      });
      return back(base, "state", refresh);
    }

    const token = await exchangeCode(cfg, {
      code,
      redirectUri: redirectUriFor(request, cfg),
      verifier: flow.verifier,
    }).catch((error) => {
      logSsoFailure("token_exchange", {
        protocol: cfg.protocol,
        tokenEndpoint: cfg.tokenEndpoint,
        tokenAuthMethod: cfg.tokenAuthMethod,
        reason: "request_failed",
      }, error);
      return null;
    });
    if (!token) return back(base, "token", refresh);
    if (!token.ok) {
      logSsoFailure("token_exchange", {
        protocol: cfg.protocol,
        tokenEndpoint: cfg.tokenEndpoint,
        tokenAuthMethod: cfg.tokenAuthMethod,
        detail: token.detail,
      });
      return back(base, "token", refresh);
    }

    let claims: Claims;
    if (cfg.protocol === "oidc") {
      if (!token.idToken) {
        logSsoFailure("oidc_token", { protocol: cfg.protocol, detail: "토큰 응답에 id_token이 없습니다." });
        return back(base, "token", refresh);
      }
      const verified = await verifyOidcIdToken(cfg, token.idToken, flow.nonce);
      if (!verified.ok) {
        logSsoFailure("oidc_verification", {
          protocol: cfg.protocol,
          issuer: cfg.issuer,
          jwksUri: cfg.jwksUri,
          clientId: cfg.clientId,
          reason: verified.reason,
          detail: verified.detail,
        });
        return back(base, verified.reason === "nonce" ? "state" : "token", refresh);
      }
      claims = verified.claims;

      if (cfg.userinfoEndpoint && token.accessToken) {
        const userinfo = await fetchUserinfo(cfg.userinfoEndpoint, token.accessToken).catch((error) => {
          logSsoFailure("userinfo_request", {
            protocol: cfg.protocol,
            userinfoEndpoint: cfg.userinfoEndpoint,
            reason: "request_failed",
          }, error);
          return null;
        });
        if (!userinfo) return back(base, "token", refresh);
        if (!userinfo.ok) {
          logSsoFailure("userinfo_request", {
            protocol: cfg.protocol,
            userinfoEndpoint: cfg.userinfoEndpoint,
            detail: userinfo.detail,
          });
          return back(base, "token", refresh);
        }
        claims = mergeClaims(claims, userinfo.claims);
      }
    } else {
      if (!token.accessToken) {
        logSsoFailure("oauth2_token", { protocol: cfg.protocol, detail: "토큰 응답에 access_token이 없습니다." });
        return back(base, "token", refresh);
      }
      const userinfo = await fetchUserinfo(cfg.userinfoEndpoint, token.accessToken).catch((error) => {
        logSsoFailure("userinfo_request", {
          protocol: cfg.protocol,
          userinfoEndpoint: cfg.userinfoEndpoint,
          reason: "request_failed",
        }, error);
        return null;
      });
      if (!userinfo) return back(base, "token", refresh);
      if (!userinfo.ok) {
        logSsoFailure("userinfo_request", {
          protocol: cfg.protocol,
          userinfoEndpoint: cfg.userinfoEndpoint,
          detail: userinfo.detail,
        });
        return back(base, "token", refresh);
      }
      claims = userinfo.claims;
    }

    const identity = resolveIdentity(claims, {
      ...cfg,
      subjectClaims: oauth2SubjectClaims(cfg.protocol, cfg.subjectClaims),
    });
    if (!identity.ok) {
      // 매핑이 틀렸을 때가 운영자에게 claim 이름 목록이 가장 필요한 순간이다.
      await recordClaimKeys(claimKeys(claims));
      logSsoFailure("identity_mapping", {
        protocol: cfg.protocol,
        reason: identity.reason,
        claimKeys: claimKeys(claims),
        subjectClaims: cfg.subjectClaims,
        emailClaims: cfg.emailClaims,
      });
      return back(base, identity.reason, refresh);
    }

    const access = decideAccess({
      groups: identity.identity.groups,
      allowedGroups: cfg.allowedGroups,
      adminGroups: cfg.adminGroups,
    });
    if (!access.allowed) {
      logSsoFailure("access_policy", {
        protocol: cfg.protocol,
        reason: "not_allowed",
        receivedGroupCount: identity.identity.groups.length,
        allowedGroupCount: cfg.allowedGroups.length,
      });
      return back(base, "not_allowed", refresh);
    }

    const bootstrapAdmin = isInitialAdminEmail(identity.identity.email);
    const result = await applySsoLogin({
      identity: identity.identity,
      isAdmin: access.isAdmin || bootstrapAdmin,
      autoCreate: cfg.autoCreate || bootstrapAdmin,
      refreshProfile: refresh,
      expectedUserId: flow?.refreshUserId,
    });
    if (!result.ok) {
      logSsoFailure("account_link", { protocol: cfg.protocol, reason: result.reason });
      return back(base, result.reason, refresh);
    }

    await recordClaimKeys(claimKeys(claims));
    await purgeExpiredSessions();
    const session = await createSession(result.user.id);

    const headers = new Headers({ location: refresh ? `${base}/settings?ssoRefresh=success` : `${base}/` });
    headers.append("set-cookie", sessionCookie(session.token, session.expiresAt, base.startsWith("https://")));
    headers.append("set-cookie", clearFlowCookie());
    return new Response(null, { status: 302, headers });
  } catch (err) {
    logSsoFailure("callback_unhandled", { callbackOrigin: url.origin }, err);
    return back(base, "server", refresh);
  }
}
