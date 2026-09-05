import { expect, test } from "vitest";
import {
  effectiveSsoMode,
  proxyAccessPolicyPayload,
} from "../src/app/settings/sso/sso-settings-form.js";

test("설정 화면은 환경변수가 아니라 저장된 네 가지 모드를 그대로 표시한다", () => {
  expect(effectiveSsoMode({ mode: "disabled" })).toBe("disabled");
  expect(effectiveSsoMode({ mode: "oidc" })).toBe("oidc");
  expect(effectiveSsoMode({ mode: "oauth2" })).toBe("oauth2");
  expect(effectiveSsoMode({ mode: "oauth2-proxy" })).toBe("oauth2-proxy");
});

test("oauth2-proxy 화면 저장은 사용하지 않는 직접 연결 설정을 포함하지 않는다", () => {
  expect(proxyAccessPolicyPayload({
    passwordLoginEnabled: false,
    allowedGroups: "developers, glossary-users",
    adminGroups: "glossary-admins",
    autoCreate: true,
  })).toEqual({
    mode: "oauth2-proxy",
    passwordLoginEnabled: false,
    allowedGroups: ["developers", "glossary-users"],
    adminGroups: ["glossary-admins"],
    autoCreate: true,
  });
});
