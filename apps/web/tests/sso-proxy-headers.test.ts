import { afterEach, expect, test } from "vitest";
import {
  authMode,
  decodeProxyHeader,
  inspectProxyHeaders,
  oauth2SubjectClaims,
  proxyHeaderNames,
  trustProxyHeaders,
} from "../src/lib/auth/sso/proxy-headers.js";

afterEach(() => {
  delete process.env.AUTH_MODE;
  delete process.env.SSO_TRUST_PROXY_HEADERS;
  delete process.env.OAUTH2_SUBJECT_FIELD;
});

test("oauth2-proxy 모드는 별도 스위치 없이 헤더를 신뢰한다", () => {
  expect(authMode({ AUTH_MODE: "oauth2-proxy" })).toBe("oauth2-proxy");
  expect(trustProxyHeaders({ AUTH_MODE: "oauth2-proxy", SSO_TRUST_PROXY_HEADERS: "false" })).toBe(true);
});

test("oidc/oauth2 모드는 명시적으로 켤 때만 프록시 헤더를 신뢰하고 local은 켤 수 없다", () => {
  expect(trustProxyHeaders({ AUTH_MODE: "oidc" })).toBe(false);
  expect(trustProxyHeaders({ AUTH_MODE: "oauth2", SSO_TRUST_PROXY_HEADERS: "true" })).toBe(true);
  expect(trustProxyHeaders({ AUTH_MODE: "local", SSO_TRUST_PROXY_HEADERS: "true" })).toBe(false);
});

test("기본 헤더에서 이메일·닉네임·첫 그룹 조직을 읽는다", () => {
  const headers = new Headers({
    "x-forwarded-preferred-username": encodeURIComponent("김의윤"),
    "x-forwarded-email": "EUIYUN@example.com",
    "x-forwarded-groups": encodeURIComponent("보안팀, 플랫폼팀"),
  });
  const result = inspectProxyHeaders(headers, { AUTH_MODE: "oauth2-proxy" });

  expect(result.detected).toBe(true);
  expect(result.identity).toEqual({
    subject: "euiyun@example.com",
    email: "euiyun@example.com",
    name: "김의윤",
    groups: ["보안팀", "플랫폼팀"],
    organization: "보안팀",
  });
});

test("latin1로 보이는 UTF-8 한글과 percent-encoded 이름을 복원한다", () => {
  const mojibake = Buffer.from("김의윤", "utf8").toString("latin1");
  expect(decodeProxyHeader(mojibake)).toBe("김의윤");
  expect(decodeProxyHeader("%EA%B9%80%EC%9D%98%EC%9C%A4")).toBe("김의윤");
  expect(decodeProxyHeader("plain@example.com")).toBe("plain@example.com");
});

test("기존 OAUTH2_PROXY_*_HEADER와 새 SSO_PROXY_*_HEADER 이름을 모두 받는다", () => {
  expect(proxyHeaderNames({
    OAUTH2_PROXY_USER_HEADER: "X-Auth-Request-User",
    OAUTH2_PROXY_EMAIL_HEADER: "X-Auth-Request-Email",
    OAUTH2_PROXY_GROUPS_HEADER: "X-Auth-Request-Groups",
  })).toEqual({
    preferredUsername: "x-auth-request-user",
    email: "x-auth-request-email",
    groups: "x-auth-request-groups",
  });

  expect(proxyHeaderNames({
    SSO_PROXY_PREFERRED_USERNAME_HEADER: "X-Company-Name",
    OAUTH2_PROXY_USER_HEADER: "X-Old-Name",
  }).preferredUsername).toBe("x-company-name");
});

test("이메일 헤더가 없거나 주소 모양이 아니면 인증하지 않는다", () => {
  expect(inspectProxyHeaders(new Headers({ "x-forwarded-preferred-username": "Kim" }), {
    AUTH_MODE: "oauth2-proxy",
  }).detected).toBe(false);
  expect(inspectProxyHeaders(new Headers({ "x-forwarded-email": "not-an-email" }), {
    AUTH_MODE: "oauth2-proxy",
  }).detected).toBe(false);
});

test("헤더 주체는 항상 이메일이고 OAUTH2_SUBJECT_FIELD는 OAuth2 코드 흐름만 맞춘다", () => {
  const headers = new Headers({
    "x-forwarded-preferred-username": "euiyun",
    "x-forwarded-email": "euiyun@example.com",
  });
  expect(inspectProxyHeaders(headers, {
    AUTH_MODE: "oauth2-proxy",
    OAUTH2_SUBJECT_FIELD: "preferred_username",
  }).identity?.subject).toBe("euiyun@example.com");
  expect(oauth2SubjectClaims("oauth2", ["sub"], { OAUTH2_SUBJECT_FIELD: "email" })).toEqual(["email", "sub"]);
  expect(oauth2SubjectClaims("oidc", ["sub"], { OAUTH2_SUBJECT_FIELD: "email" })).toEqual(["sub"]);
});
