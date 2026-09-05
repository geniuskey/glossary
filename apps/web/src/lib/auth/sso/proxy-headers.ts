import type { SsoIdentity } from "./claims";
import { repairMojibake } from "./encoding";

export const AUTH_MODES = ["local", "oidc", "oauth2", "oauth2-proxy"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];
type Env = Readonly<Record<string, string | undefined>>;

export interface ProxyHeaderNames {
  preferredUsername: string;
  email: string;
  groups: string;
}

export interface ProxyHeaderInspection {
  authMode: AuthMode;
  trusted: boolean;
  detected: boolean;
  headerNames: ProxyHeaderNames;
  presentHeaders: string[];
  missingHeaders: string[];
  identity: (SsoIdentity & { organization: string | null }) | null;
}

const DEFAULT_HEADERS: ProxyHeaderNames = {
  preferredUsername: "x-forwarded-preferred-username",
  email: "x-forwarded-email",
  groups: "x-forwarded-groups",
};

/** 환경변수 오타로 임의 헤더 조회가 되지 않도록 RFC token 모양만 받는다. */
function headerName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized) ? normalized : fallback;
}

export function authMode(env: Env = process.env): AuthMode {
  const value = env.AUTH_MODE?.trim().toLowerCase();
  return AUTH_MODES.includes(value as AuthMode) ? value as AuthMode : "local";
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

/**
 * 이 배포가 oauth2-proxy가 검증한 헤더를 안전하게 받을 수 있다는 capability다.
 * 예전 AUTH_MODE/SSO_TRUST_PROXY_HEADERS도 업데이트 중 인증이 끊기지 않게 받는다.
 */
export function oauth2ProxyEnabled(env: Env = process.env): boolean {
  const legacyMode = authMode(env);
  return enabled(env.OAUTH2_PROXY_ENABLED)
    || legacyMode === "oauth2-proxy"
    || ((legacyMode === "oidc" || legacyMode === "oauth2") && enabled(env.SSO_TRUST_PROXY_HEADERS));
}

/** 명시 모드가 아직 없는 기존 proxy 설치를 무중단으로 이어갈 조건이다. */
export function oauth2ProxyDefaultSelected(env: Env = process.env): boolean {
  return authMode(env) === "oauth2-proxy";
}

export function trustProxyHeaders(env: Env = process.env): boolean {
  return oauth2ProxyEnabled(env);
}

/**
 * OAUTH2_PROXY_*_HEADER는 기존 배포 이름이고 SSO_PROXY_*_HEADER는 Glossary 쪽
 * 명시 이름이다. 둘 다 있으면 Glossary 이름을 우선한다.
 */
export function proxyHeaderNames(env: Env = process.env): ProxyHeaderNames {
  return {
    preferredUsername: headerName(
      env.SSO_PROXY_PREFERRED_USERNAME_HEADER
        ?? env.OAUTH2_PROXY_PREFERRED_USERNAME_HEADER
        ?? env.OAUTH2_PROXY_USER_HEADER
        ?? env.OAUTH2_PROXY_NAME_HEADER,
      DEFAULT_HEADERS.preferredUsername,
    ),
    email: headerName(
      env.SSO_PROXY_EMAIL_HEADER ?? env.OAUTH2_PROXY_EMAIL_HEADER,
      DEFAULT_HEADERS.email,
    ),
    groups: headerName(
      env.SSO_PROXY_GROUPS_HEADER ?? env.OAUTH2_PROXY_GROUPS_HEADER,
      DEFAULT_HEADERS.groups,
    ),
  };
}

/**
 * nginx → Node 구간에서 UTF-8 헤더 바이트가 latin1 문자열로 보이는 경우를
 * 되돌린다. 이미 정상 Unicode인 값과 ASCII 값은 건드리지 않고, percent-encoded
 * 값을 쓰는 프록시도 함께 받는다.
 */
export function decodeProxyHeader(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // 잘못된 percent sequence는 원문으로 계속 판정한다.
    }
  }

  return repairMojibake(value) || null;
}

function groupsFrom(raw: string | null): string[] {
  const decoded = decodeProxyHeader(raw);
  if (!decoded) return [];
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const part of decoded.split(",")) {
    const group = part.trim();
    if (!group || seen.has(group)) continue;
    seen.add(group);
    groups.push(group);
  }
  return groups;
}

export function inspectProxyHeaders(
  headers: Headers,
  env: Env = process.env,
  trustedOverride?: boolean,
): ProxyHeaderInspection {
  const names = proxyHeaderNames(env);
  const entries = [names.preferredUsername, names.email, names.groups];
  const presentHeaders = entries.filter((name) => Boolean(headers.get(name)));
  const missingHeaders = entries.filter((name) => !headers.get(name));
  const trusted = trustedOverride ?? trustProxyHeaders(env);
  const email = decodeProxyHeader(headers.get(names.email))?.toLowerCase() ?? null;
  const preferredUsername = decodeProxyHeader(headers.get(names.preferredUsername));
  const groups = groupsFrom(headers.get(names.groups));
  const validEmail = email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
  const identity = trusted && validEmail
    ? {
        // 헤더 경로의 안정 식별자는 계약상 언제나 이메일이다. 이 값을 바꾸는
        // OAUTH2_SUBJECT_FIELD는 직접 OAuth2 코드 흐름을 여기에 맞추는 용도다.
        subject: validEmail,
        email: validEmail,
        name: preferredUsername ?? validEmail,
        groups,
        organization: groups[0] ?? null,
      }
    : null;

  return {
    authMode: authMode(env),
    trusted,
    detected: identity !== null,
    headerNames: names,
    presentHeaders,
    missingHeaders,
    identity,
  };
}

export function oauth2SubjectClaims(
  protocol: "oidc" | "oauth2",
  configured: readonly string[],
  env: Env = process.env,
): readonly string[] {
  const override = env.OAUTH2_SUBJECT_FIELD?.trim();
  if (protocol !== "oauth2" || !override) return configured;
  return [override, ...configured.filter((claim) => claim !== override)];
}
