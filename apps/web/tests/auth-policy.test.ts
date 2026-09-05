import { afterEach, expect, test } from "vitest";
import {
  initialAdminEmail,
  isInitialAdminEmail,
  initialPasswordLoginEnabled,
  ssoLoginUrl,
} from "../src/lib/auth/policy.js";
import { POST as setupPost } from "../src/app/api/v1/setup/route.js";

afterEach(() => {
  delete process.env.PASSWORD_LOGIN_ENABLED;
});

test("비밀번호 로그인은 기본 활성이고 명시적으로 끌 수 있다", () => {
  expect(initialPasswordLoginEnabled({})).toBe(true);
  expect(initialPasswordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "false" })).toBe(false);
  expect(initialPasswordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "OFF" })).toBe(false);
  expect(initialPasswordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "true" })).toBe(true);
});

test("최초 관리자 이메일은 공백과 대소문자를 정규화한다", () => {
  const env = { INITIAL_ADMIN_EMAIL: " Admin@Example.COM " };
  expect(initialAdminEmail(env)).toBe("admin@example.com");
  expect(isInitialAdminEmail("ADMIN@example.com", env)).toBe(true);
  expect(initialAdminEmail({ INITIAL_ADMIN_EMAIL: "not-an-email" })).toBeNull();
});

test("oauth2-proxy는 홈으로 돌아오는 표준 진입점과 사용자 지정 URL을 제공한다", () => {
  expect(ssoLoginUrl("oauth2-proxy", "/", { OAUTH2_PROXY_ENABLED: "true" })).toBe("/oauth2/start?rd=%2F");
  expect(ssoLoginUrl("oauth2-proxy", "/", {
    OAUTH2_PROXY_ENABLED: "true",
    SSO_LOGIN_URL: "/oauth2/sign_in?rd=%2F",
  })).toBe("/oauth2/sign_in?rd=%2F");
  expect(ssoLoginUrl("oauth2-proxy", "/", {})).toBeNull();
  expect(ssoLoginUrl("oidc", "/", {})).toBe("/auth/sso/start");
  expect(ssoLoginUrl("disabled", "/", {})).toBeNull();
});

test("비밀번호를 끄면 최초 비밀번호 관리자 생성 API도 닫힌다", async () => {
  process.env.PASSWORD_LOGIN_ENABLED = "false";
  const response = await setupPost(new Request("http://x/api/v1/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "long-enough-password" }),
  }));
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "password_login_disabled" } });
});
