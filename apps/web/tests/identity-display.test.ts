import { expect, test } from "vitest";
import { emailDomainOf, userDisplayLabel } from "../src/lib/workspace/identity-display-values.js";

test("같은 회사 도메인의 담당자는 이름과 조직으로 표시한다", () => {
  expect(userDisplayLabel(
    { name: "김민지", email: "minji@Company.COM" },
    { emailDomain: "company.com", organization: "Platform 조직" },
  )).toBe("김민지 · Platform 조직");
});

test("다른 도메인과 설정되지 않은 워크스페이스는 이메일을 유지한다", () => {
  const user = { name: "Alex", email: "alex@partner.example" };
  expect(userDisplayLabel(user, { emailDomain: "company.com", organization: "Platform 조직" }))
    .toBe("Alex · alex@partner.example");
  expect(userDisplayLabel(user, { emailDomain: "", organization: "" }))
    .toBe("Alex · alex@partner.example");
});

test("이메일 도메인은 마지막 @ 뒤를 소문자로 정규화한다", () => {
  expect(emailDomainOf("user@Sub.Company.COM ")).toBe("sub.company.com");
});
