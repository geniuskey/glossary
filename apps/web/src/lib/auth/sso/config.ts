import { eq, type InferSelectModel } from "drizzle-orm";
import { ssoConfig } from "@grossary/db";
import { getDb } from "@/lib/db";

export type SsoConfig = InferSelectModel<typeof ssoConfig>;

/** 행은 언제나 이 하나다(sso_config_single_row 체크 제약이 이 값을 강제한다). */
export const SSO_CONFIG_ID = "default";

/**
 * R132: 기본값은 TS가 아니라 DB 컬럼 기본값이 소유한다. 여기서 기본 객체를 따로
 * 만들면 마이그레이션과 이 파일이 조용히 갈라진다 — 없으면 빈 행을 만들고 다시
 * 읽어서, 화면이 보는 기본값과 DB의 기본값이 같은 것이 되게 한다.
 */
export async function loadSsoConfig(): Promise<SsoConfig> {
  const db = getDb();
  const [row] = await db.select().from(ssoConfig).where(eq(ssoConfig.id, SSO_CONFIG_ID)).limit(1);
  if (row) return row;

  await db.insert(ssoConfig).values({ id: SSO_CONFIG_ID }).onConflictDoNothing();
  const [created] = await db.select().from(ssoConfig).where(eq(ssoConfig.id, SSO_CONFIG_ID)).limit(1);
  if (!created) throw new Error("SSO 설정 행을 만들지 못했습니다.");
  return created;
}

export type PublicSsoConfig = Omit<SsoConfig, "clientSecret"> & { hasClientSecret: boolean };

/**
 * 화면·API로 나가는 형태. client_secret은 저장한 뒤로는 다시 내보내지 않는다 —
 * 설정 화면을 열 수 있는 사람과 IdP 비밀값을 알아도 되는 사람이 항상 같지는 않고,
 * 브라우저 캐시·프록시 로그에 남을 이유도 없다. 대신 "채워져 있는가"만 알려준다.
 */
export function publicSsoConfig(cfg: SsoConfig): PublicSsoConfig {
  const { clientSecret, ...rest } = cfg;
  return { ...rest, hasClientSecret: clientSecret.length > 0 };
}

// clientSecret만 따로 뽑아 null을 허용한다. 교집합(`& { clientSecret?: string | null }`)
// 으로 붙이면 Partial 쪽의 `string | undefined`와 만나 null이 도로 사라진다.
export type SsoConfigPatch = Partial<
  Omit<SsoConfig, "id" | "updatedAt" | "updatedBy" | "lastClaimKeys" | "lastLoginAt" | "clientSecret">
> & { clientSecret?: string | null };

/**
 * R132: 켜기 전에 갖춰야 하는 것들. 비어 있는 채로 enabled만 켜면 로그인 화면에
 * 버튼이 생기고, 누른 사람은 IdP 대신 에러로 튕긴다 — 그 실패는 운영자가 아니라
 * 사용자에게 먼저 보인다. 그래서 저장 시점에 막는다.
 */
export function validateSsoConfig(cfg: SsoConfig): string[] {
  if (!cfg.enabled) return [];

  const problems: string[] = [];
  if (!cfg.authorizationEndpoint) problems.push("인가 엔드포인트가 비어 있습니다.");
  if (!cfg.tokenEndpoint) problems.push("토큰 엔드포인트가 비어 있습니다.");
  if (!cfg.clientId) problems.push("클라이언트 ID가 비어 있습니다.");
  if (!cfg.clientSecret) problems.push("클라이언트 시크릿이 비어 있습니다.");
  if (cfg.subjectClaims.length === 0) problems.push("주체(sub) claim 후보가 비어 있습니다.");
  if (cfg.emailClaims.length === 0) problems.push("이메일 claim 후보가 비어 있습니다.");
  if (cfg.adminGroups.length > 0 && cfg.groupClaims.length === 0) {
    // 그룹을 읽지 못하면 관리자 그룹은 영원히 아무에게도 걸리지 않는다.
    problems.push("관리자 그룹을 지정하려면 그룹 claim 후보가 필요합니다.");
  }
  return problems;
}

export type SaveResult = { ok: true; config: SsoConfig } | { ok: false; problems: string[] };

/**
 * 부분 갱신이다. 특히 clientSecret은 **빈 문자열이면 그대로 둔다** —
 * publicSsoConfig가 비밀값을 돌려주지 않으므로 설정 화면은 언제나 빈 칸으로 열리고,
 * 그 빈 칸을 저장이라고 그대로 반영하면 다른 항목 하나 고칠 때마다 SSO가 꺼진다.
 * 비밀값을 지우려면 명시적으로 null을 보낸다.
 */
export async function saveSsoConfig(patch: SsoConfigPatch, updatedBy: string | null): Promise<SaveResult> {
  const current = await loadSsoConfig();
  const { clientSecret, ...rest } = patch;
  const next: SsoConfig = {
    ...current,
    ...rest,
    clientSecret: clientSecret === null ? "" : clientSecret || current.clientSecret,
  };

  const problems = validateSsoConfig(next);
  if (problems.length > 0) return { ok: false, problems };

  const [saved] = await getDb()
    .update(ssoConfig)
    .set({ ...next, id: SSO_CONFIG_ID, updatedAt: new Date(), updatedBy })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID))
    .returning();
  if (!saved) throw new Error("SSO 설정을 저장하지 못했습니다.");
  return { ok: true, config: saved };
}

/** 로그인이 성공할 때마다 "IdP가 실제로 보낸 claim 이름"을 갱신한다(값은 남기지 않는다). */
export async function recordClaimKeys(keys: string[]): Promise<void> {
  await getDb()
    .update(ssoConfig)
    .set({ lastClaimKeys: keys, lastLoginAt: new Date() })
    .where(eq(ssoConfig.id, SSO_CONFIG_ID));
}

export function discoveryUrl(issuer: string): string {
  // issuer 끝의 /를 그대로 두면 //.well-known이 되어 404를 주는 IdP가 있다.
  return `${issuer.trim().replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export interface Discovered {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  scopesSupported: string[];
  claimsSupported: string[];
}

/** 발견 문서에서 이 앱이 쓰는 값만 꺼낸다. 없는 항목은 빈 문자열로 둔다(손으로 채울 수 있게). */
export function readDiscovery(doc: unknown): Discovered | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  const authorizationEndpoint = text(d.authorization_endpoint);
  const tokenEndpoint = text(d.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) return null;

  return {
    issuer: text(d.issuer),
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint: text(d.userinfo_endpoint),
    scopesSupported: list(d.scopes_supported),
    // 이 목록이 곧 "이 IdP에서 고를 수 있는 claim 이름"이라 설정 화면의 힌트가 된다.
    claimsSupported: list(d.claims_supported),
  };
}

export async function discoverOidc(issuer: string): Promise<Discovered | null> {
  const res = await fetch(discoveryUrl(issuer), { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  return readDiscovery(await res.json().catch(() => null));
}
