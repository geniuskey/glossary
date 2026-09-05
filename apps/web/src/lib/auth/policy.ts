import type { SsoMode } from "./sso/config";
import { oauth2ProxyEnabled } from "./sso/proxy-headers";

type Env = Readonly<Record<string, string | undefined>>;

function falseLike(value: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test(value?.trim() ?? "");
}

/** DB 정책이 아직 없는 최초 부팅/기존 설치에서만 쓰는 환경변수 초기값이다. */
export function initialPasswordLoginEnabled(env: Env = process.env): boolean {
  return !falseLike(env.PASSWORD_LOGIN_ENABLED);
}

export function initialAdminEmail(env: Env = process.env): string | null {
  const value = env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : null;
}

export function isInitialAdminEmail(email: string, env: Env = process.env): boolean {
  const configured = initialAdminEmail(env);
  return configured !== null && configured === email.trim().toLowerCase();
}

function configuredSsoUrl(value: string | undefined): string | null {
  const url = value?.trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 비밀번호를 끈 화면이 보낼 SSO 진입점. oauth2-proxy는 표준 /oauth2/start를
 * 기본으로 쓰며, 프록시 prefix가 다르면 SSO_LOGIN_URL로 완성된 URL을 지정한다.
 */
export function ssoLoginUrl(
  mode: SsoMode,
  returnTo = "/",
  env: Env = process.env,
): string | null {
  if (mode === "oauth2-proxy") {
    if (!oauth2ProxyEnabled(env)) return null;
    return configuredSsoUrl(env.SSO_LOGIN_URL)
      ?? `/oauth2/start?rd=${encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/")}`;
  }
  return mode === "oidc" || mode === "oauth2" ? "/auth/sso/start" : null;
}
