import { methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadSsoConfig, resolveSsoMode } from "@/lib/auth/sso/config";
import { inspectProxyHeaders, oauth2ProxyEnabled } from "@/lib/auth/sso/proxy-headers";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

/** 관리자 자신의 요청에 실제로 도착한 헤더만 검사한다. 저장된 예시값은 쓰지 않는다. */
export const GET = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const cfg = await loadSsoConfig();
  const proxyAvailable = oauth2ProxyEnabled();
  return Response.json({
    proxyHeaders: {
      ...inspectProxyHeaders(request.headers, process.env, proxyAvailable),
      ssoMode: resolveSsoMode(cfg),
      proxyAvailable,
    },
  });
});
