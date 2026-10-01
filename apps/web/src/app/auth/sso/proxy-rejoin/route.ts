import { methodStubs } from "@/lib/api-error";
import { enforceCsrf } from "@/lib/auth/csrf";
import { isInitialAdminEmail } from "@/lib/auth/policy";
import { loadSsoConfig, resolveSsoMode } from "@/lib/auth/sso/config";
import { decideAccess } from "@/lib/auth/sso/claims";
import { applySsoLogin } from "@/lib/auth/sso/login";
import { inspectProxyHeaders } from "@/lib/auth/sso/proxy-headers";
import { logSsoFailure } from "@/lib/auth/sso/diagnostics";
import { eq } from "drizzle-orm";
import { ssoWithdrawals } from "@glossary/db";
import { ssoSubjectHash } from "@/lib/auth/account-policy";
import { getDb } from "@/lib/db";

const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(["POST"]);
export { GET, PUT, PATCH, DELETE, OPTIONS };

function loginError(code: string) {
  return new Response(null, { status: 303, headers: { location: `/login?sso=${code}` } });
}

/** A same-origin form submission is explicit consent to create a new account. */
export async function POST(request: Request) {
  if (enforceCsrf(request)) return loginError("state");
  try {
    const cfg = await loadSsoConfig();
    if (resolveSsoMode(cfg) !== "oauth2-proxy") return loginError("disabled");
    const { identity } = inspectProxyHeaders(request.headers);
    if (!identity) return loginError("idp");
    const [withdrawn] = await getDb().select().from(ssoWithdrawals)
      .where(eq(ssoWithdrawals.subjectHash, ssoSubjectHash(identity.subject))).limit(1);
    if (!withdrawn) return new Response(null, { status: 303, headers: { location: "/" } });
    const access = decideAccess({ groups: identity.groups, allowedGroups: cfg.allowedGroups, adminGroups: cfg.adminGroups });
    if (!access.allowed) return loginError("not_allowed");
    const bootstrapAdmin = isInitialAdminEmail(identity.email);
    const result = await applySsoLogin({ identity, isAdmin: access.isAdmin || bootstrapAdmin, autoCreate: cfg.autoCreate || bootstrapAdmin });
    if (!result.ok) return loginError(result.reason);
    return new Response(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
  } catch (error) {
    logSsoFailure("proxy_rejoin", {}, error);
    return loginError("server");
  }
}
