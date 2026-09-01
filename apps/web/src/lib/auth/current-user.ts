import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { sessions, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { hashSessionToken, SESSION_COOKIE } from "./session";
import { needsSetup } from "./setup";
import { decideAccess } from "./sso/claims";
import { loadSsoConfig } from "./sso/config";
import { logSsoFailure } from "./sso/diagnostics";
import { applySsoLogin } from "./sso/login";
import { authMode, inspectProxyHeaders, trustProxyHeaders } from "./sso/proxy-headers";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
  /** SSO 그룹의 첫 항목. 계정 메뉴에 표시할 조직 이름이다. */
  organization?: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const mode = authMode();
  if (trustProxyHeaders()) {
    const inspection = inspectProxyHeaders(await headers());
    if (inspection.identity) {
      // 최초 설치에서는 프록시를 통과한 첫 일반 사용자가 자동 생성되어 /setup을
      // 닫아버리면 안 된다. 로컬 최초 관리자를 만든 뒤 헤더 계정 연결을 시작한다.
      if (await needsSetup()) return null;

      const cfg = await loadSsoConfig();
      const access = decideAccess({
        groups: inspection.identity.groups,
        allowedGroups: cfg.allowedGroups,
        adminGroups: cfg.adminGroups,
      });
      if (!access.allowed) {
        logSsoFailure("proxy_header_access", {
          authMode: mode,
          reason: "not_allowed",
          receivedGroupCount: inspection.identity.groups.length,
          allowedGroupCount: cfg.allowedGroups.length,
        });
        return null;
      }

      const result = await applySsoLogin({
        identity: inspection.identity,
        isAdmin: access.isAdmin,
        autoCreate: cfg.autoCreate,
      });
      if (!result.ok) {
        logSsoFailure("proxy_header_account", { authMode: mode, reason: result.reason });
        return null;
      }
      return { ...result.user, organization: inspection.identity.organization };
    }

    // 전용 모드에서 헤더가 없는데 로컬 세션으로 우회하면 앱 직접 접속이 프록시를
    // 건너뛰는 인증 경로가 된다. 혼합 oidc/oauth2 모드에서만 세션으로 계속 간다.
    if (mode === "oauth2-proxy") return null;
  }

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, ssoGroups: users.ssoGroups })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  const { ssoGroups, ...user } = row;
  return ssoGroups?.[0] ? { ...user, organization: ssoGroups[0] } : user;
}
