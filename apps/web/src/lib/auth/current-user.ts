import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { sessions, users } from "@glossary/db";
import { getDb } from "@/lib/db";
import { hashSessionToken, SESSION_COOKIE } from "./session";
import { isInitialAdminEmail } from "./policy";
import { needsSetup } from "./setup";
import { decideAccess } from "./sso/claims";
import { loadSsoConfig, resolveLoginSsoMode, resolveSsoMode, saveSsoConfig } from "./sso/config";
import { logSsoFailure } from "./sso/diagnostics";
import { applySsoLogin } from "./sso/login";
import { inspectProxyHeaders, oauth2ProxyEnabled } from "./sso/proxy-headers";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
  /** SSO 그룹의 첫 항목. 계정 메뉴에 표시할 조직 이름이다. */
  organization?: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // 요청 API를 DB 설정보다 먼저 읽어 이 함수가 항상 런타임 경계 안에서 실행되게
  // 한다. 그렇지 않으면 Next 빌드가 페이지를 미리 렌더링하며 DB에 접근해, 런타임
  // DATABASE_URL만 주입하는 Docker 이미지 빌드가 실패한다.
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const cfg = await loadSsoConfig();
  const configuredMode = resolveSsoMode(cfg);
  const bootstrapCandidate = cfg.mode === null
    && configuredMode === "disabled"
    && oauth2ProxyEnabled();
  const setupNeeded = bootstrapCandidate ? await needsSetup() : false;
  const mode = resolveLoginSsoMode(cfg, setupNeeded);
  if (mode === "oauth2-proxy") {
    const inspection = inspectProxyHeaders(requestHeaders, process.env, oauth2ProxyEnabled());
    if (inspection.identity) {
      const bootstrapAdmin = isInitialAdminEmail(inspection.identity.email);
      // 최초 설치에서는 프록시를 통과한 첫 일반 사용자가 자동 생성되어 /setup을
      // 닫아버리면 안 된다. 환경변수로 지정한 최초 관리자만 SSO로 부트스트랩한다.
      const currentlyNeedsSetup = setupNeeded || await needsSetup();
      if (currentlyNeedsSetup && !bootstrapAdmin) return null;

      const access = decideAccess({
        groups: inspection.identity.groups,
        allowedGroups: cfg.allowedGroups,
        adminGroups: cfg.adminGroups,
      });
      if (!access.allowed) {
        logSsoFailure("proxy_header_access", {
          ssoMode: mode,
          reason: "not_allowed",
          receivedGroupCount: inspection.identity.groups.length,
          allowedGroupCount: cfg.allowedGroups.length,
        });
        return null;
      }

      if (bootstrapCandidate && currentlyNeedsSetup && bootstrapAdmin) {
        // 계정을 만들기 전에 모드를 고정한다. 이 저장이 실패한 뒤 사용자만 남으면
        // needsSetup이 닫혀 다음 요청에서 proxy 부트스트랩을 다시 시도할 수 없다.
        const selected = await saveSsoConfig({ mode: "oauth2-proxy" }, null);
        if (!selected.ok) {
          logSsoFailure("proxy_bootstrap_mode", { ssoMode: mode, problems: selected.problems });
          return null;
        }
      }

      const result = await applySsoLogin({
        identity: inspection.identity,
        isAdmin: access.isAdmin || bootstrapAdmin,
        autoCreate: cfg.autoCreate || bootstrapAdmin,
      });
      if (!result.ok) {
        logSsoFailure("proxy_header_account", { ssoMode: mode, reason: result.reason });
        return null;
      }
      return { ...result.user, organization: inspection.identity.organization };
    }

    // proxy 모드에서 헤더가 없는데 로컬 세션으로 우회하면 앱 직접 접속이 프록시를
    // 건너뛰는 인증 경로가 된다. capability가 잘못 꺼진 경우에도 fail closed 한다.
    return null;
  }

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
