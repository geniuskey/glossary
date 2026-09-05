import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { users } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isInitialAdminEmail } from "@/lib/auth/policy";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { decideAccess } from "@/lib/auth/sso/claims";
import { loadSsoConfig, resolveSsoMode } from "@/lib/auth/sso/config";
import { applySsoLogin } from "@/lib/auth/sso/login";
import { inspectProxyHeaders } from "@/lib/auth/sso/proxy-headers";
import { getDb } from "@/lib/db";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

/**
 * 현재 프록시 헤더가 있으면 즉시 다시 읽고, 직접 OIDC/OAuth2 연결이면 재인증
 * 시작 주소를 돌려준다. 이름 덮어쓰기는 이 명시적인 사용자 동작에서만 허용한다.
 */
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  if (auth.kind !== "user") return apiError("forbidden", "사용자 계정으로 로그인해야 합니다.", 403);

  const cfg = await loadSsoConfig();
  const mode = resolveSsoMode(cfg);
  if (mode === "oauth2-proxy") {
    const inspection = inspectProxyHeaders(await headers());
    if (!inspection.identity) {
      return apiError("operation_conflict", "oauth2-proxy 인증 헤더를 확인할 수 없습니다.", 409);
    }
    const access = decideAccess({
      groups: inspection.identity.groups,
      allowedGroups: cfg.allowedGroups,
      adminGroups: cfg.adminGroups,
    });
    if (!access.allowed) {
      return apiError("forbidden", "이 사전에 접근이 허용된 SSO 그룹이 아닙니다.", 403);
    }

    const bootstrapAdmin = isInitialAdminEmail(inspection.identity.email);
    const result = await applySsoLogin({
      identity: inspection.identity,
      isAdmin: access.isAdmin || bootstrapAdmin,
      autoCreate: false,
      refreshProfile: true,
      expectedUserId: auth.user.id,
    });
    if (!result.ok) {
      return apiError("operation_conflict", "현재 로그인한 계정과 SSO 계정이 일치하지 않습니다.", 409);
    }
    return Response.json({ user: result.user, refreshed: true });
  }

  if (mode !== "oidc" && mode !== "oauth2") {
    return apiError("operation_conflict", "현재 SSO 로그인을 사용하지 않습니다.", 409);
  }

  const [account] = await getDb()
    .select({ externalId: users.externalId })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  if (!account?.externalId) {
    return apiError("operation_conflict", "SSO로 연결된 계정에서만 정보를 다시 가져올 수 있습니다.", 409);
  }
  if (!cfg.authorizationEndpoint || !cfg.clientId) {
    return apiError("operation_conflict", "사용할 수 있는 SSO 연결이 없습니다. 관리자에게 문의하세요.", 409);
  }

  return Response.json({ redirectTo: "/auth/sso/start?refresh=1", refreshed: false });
});
