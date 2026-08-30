import { expect, test } from "vitest";
import { userDisplayLabel } from "../src/lib/workspace/identity-display-values.js";

test("SSO 담당자는 이름과 IdP가 확인한 그룹/조직으로 표시한다", () => {
  expect(userDisplayLabel(
    { name: "김민지", email: "minji@company.com", ssoGroups: ["Platform 조직", "검색팀"] },
  )).toBe("김민지 · Platform 조직, 검색팀");
});

test("로컬 계정이나 그룹이 없는 SSO 계정은 이메일을 유지한다", () => {
  expect(userDisplayLabel({ name: "Alex", email: "alex@partner.example", ssoGroups: null }))
    .toBe("Alex · alex@partner.example");
  expect(userDisplayLabel({ name: "Kim", email: "kim@company.com", ssoGroups: [] }))
    .toBe("Kim · kim@company.com");
});
