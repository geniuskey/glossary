import { expect, test, vi } from "vitest";
import { logSsoFailure, sanitizeSsoValue } from "../src/lib/auth/sso/diagnostics.js";

test("SSO 진단 값은 토큰·코드·시크릿을 가리고 공급자 오류는 보존한다", () => {
  expect(sanitizeSsoValue({
    access_token: "access-secret",
    id_token: "id-secret",
    code: "authorization-code",
    nested: { client_secret: "client-secret", error_description: "redirect_uri mismatch" },
  })).toEqual({
    access_token: "[redacted]",
    id_token: "[redacted]",
    code: "[redacted]",
    nested: { client_secret: "[redacted]", error_description: "redirect_uri mismatch" },
  });
});

test("콘솔 로그에는 단계와 예외 상세가 JSON으로 남고 민감값은 남지 않는다", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});

  logSsoFailure("token_exchange", {
    protocol: "oidc",
    code: "authorization-code",
    providerError: "invalid_grant",
  }, Object.assign(new Error("TLS handshake failed"), { access_token: "access-secret" }));

  const line = output.mock.calls.flat().join(" ");
  expect(line).toContain("[Glossary SSO]");
  expect(line).toContain('"stage":"token_exchange"');
  expect(line).toContain("invalid_grant");
  expect(line).toContain("TLS handshake failed");
  expect(line).not.toContain("authorization-code");
  expect(line).not.toContain("access-secret");
  output.mockRestore();
});
