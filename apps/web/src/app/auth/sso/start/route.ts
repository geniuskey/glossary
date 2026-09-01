import { methodStubs } from "@/lib/api-error";
import { loadSsoConfig } from "@/lib/auth/sso/config";
import {
  buildAuthorizeUrl,
  flowCookie,
  pkceChallenge,
  randomToken,
  redirectUriFor,
  resolveBaseUrl,
} from "@/lib/auth/sso/flow";
import type { SsoErrorCode } from "@/lib/auth/sso/errors";
import { logSsoFailure } from "@/lib/auth/sso/diagnostics";

/**
 * R132: 이 두 라우트(start·callback)만 /api/v1 밖에 있다.
 *
 * 이유는 둘 다 **브라우저 내비게이션의 중간 지점**이기 때문이다. 여기서 JSON
 * 에러 봉투를 돌려주면 IdP에서 튕겨 나온 사람이 화면 가득 `{"error":...}`를 본다.
 * 그래서 이 둘은 에러 응답 자체가 없고, 실패든 성공이든 302로만 답한다
 * ("모든 API 에러는 JSON" 규약은 /api/v1의 계약이고, 이 둘은 그 계약의 대상이 아니다).
 * 로그인 화면에 붙일 링크가 /api/로 가지 않는다는 점에서 R95(PROTO A)와도 맞는다.
 */
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

function loginRedirect(base: string, code: SsoErrorCode): Response {
  return new Response(null, { status: 302, headers: { location: `${base}/login?sso=${code}` } });
}

export async function GET(request: Request): Promise<Response> {
  const cfg = await loadSsoConfig().catch((error) => {
    logSsoFailure("config_load", { route: "start" }, error);
    return null;
  });
  const base = resolveBaseUrl(request, { baseUrl: cfg?.baseUrl ?? "" });
  if (!cfg) return loginRedirect(base, "server");
  if (!cfg.enabled || !cfg.authorizationEndpoint || !cfg.clientId) return loginRedirect(base, "disabled");

  const verifier = randomToken();
  const flow = { state: randomToken(), nonce: randomToken(), verifier, protocol: cfg.protocol };

  try {
    const url = buildAuthorizeUrl(cfg, {
      redirectUri: redirectUriFor(request, cfg),
      state: flow.state,
      nonce: flow.nonce,
      challenge: pkceChallenge(verifier),
    });
    return new Response(null, {
      status: 302,
      headers: { location: url, "set-cookie": flowCookie(flow, base.startsWith("https://")) },
    });
  } catch (err) {
    // 인가 엔드포인트가 URL이 아니면 여기서 던진다(설정 저장 때 걸러지지만,
    // 저장 이후에 DB를 직접 고친 경우가 남는다).
    logSsoFailure("authorize_redirect", {
      protocol: cfg.protocol,
      authorizationEndpoint: cfg.authorizationEndpoint,
      clientId: cfg.clientId,
    }, err);
    return loginRedirect(base, "disabled");
  }
}
