import { expect, test } from "vitest";
import {
  claimKeys,
  decideAccess,
  decodeJwtPayload,
  formatClaimList,
  parseClaimList,
  pickClaim,
  pickGroups,
  readClaim,
  resolveIdentity,
} from "../src/lib/auth/sso/claims.js";

const MAPPING = {
  subjectClaims: ["sub"],
  emailClaims: ["email", "upn"],
  nameClaims: ["name", "displayName", "preferred_username"],
  groupClaims: ["groups", "roles"],
};

test("설정 한 줄을 쉼표·줄바꿈 어느 쪽으로 적어도 같은 목록이 된다", () => {
  expect(parseClaimList("name, displayName\n preferred_username ,")).toEqual([
    "name",
    "displayName",
    "preferred_username",
  ]);
  expect(formatClaimList(["name", "displayName"])).toBe("name, displayName");
  expect(parseClaimList(formatClaimList(["a", "b"]))).toEqual(["a", "b"]);
});

// 이 저장소가 SSO에서 가장 조용히 틀리는 지점: ADFS/Entra의 claim 이름에는 점이 들어 있다.
// 점을 무조건 경로 구분자로 보면 그 이름은 영영 못 찾고, 화면에는 "이메일이 없다"만 뜬다.
test("점이 들어 있는 claim 이름은 경로가 아니라 이름 전체로 찾는다", () => {
  const claims = {
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "kim@example.com",
    user: { profile: { name: "김철수" } },
  };

  expect(readClaim(claims, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")).toBe(
    "kim@example.com",
  );
  expect(readClaim(claims, "user.profile.name")).toBe("김철수");
  expect(readClaim(claims, "user.missing.name")).toBeUndefined();
});

test("후보는 순서가 곧 우선순위다 — 값이 있는 첫 후보를 쓴다", () => {
  expect(pickClaim({ displayName: "김철수", preferred_username: "kim" }, MAPPING.nameClaims)).toBe("김철수");
  // 빈 문자열·공백은 "값이 없다"로 본다. 그러지 않으면 빈 이름이 이력에 남는다.
  expect(pickClaim({ name: "   ", displayName: "김철수" }, MAPPING.nameClaims)).toBe("김철수");
  expect(pickClaim({ sub: 10482 }, ["sub"])).toBe("10482");
  expect(pickClaim({ upn: ["kim@example.com"] }, MAPPING.emailClaims)).toBe("kim@example.com");
  expect(pickClaim({}, MAPPING.nameClaims)).toBeNull();
});

// 그룹은 "첫 후보만"이 아니라 전부 합친다 — 접근 권한은 groups에, 관리자 표시는
// roles에 오는 IdP가 있어서, 한쪽만 읽으면 둘 중 하나가 조용히 사라진다.
test("그룹은 후보 여러 곳의 값을 합치고 형태가 달라도 읽는다", () => {
  const claims = {
    groups: ["dev", "Dev", "qa"],
    roles: "admin,ops",
    extra: [{ displayName: "보안팀" }, { value: "감사팀" }],
  };

  expect(pickGroups(claims, ["groups", "roles", "extra"]).sort()).toEqual(
    ["Dev", "admin", "감사팀", "dev", "ops", "qa", "보안팀"].sort(),
  );
});

// 그룹 이름에는 공백이 들어간다("Domain Admins"). 공백까지 구분자로 쪼개면
// 존재하지 않는 그룹 두 개가 생기고 허용 목록에 영영 안 걸린다.
test("쉼표로 이어 붙인 그룹 문자열은 쉼표로만 자른다", () => {
  expect(pickGroups({ groups: "Domain Admins, Glossary Editors" }, ["groups"])).toEqual([
    "Domain Admins",
    "Glossary Editors",
  ]);
});

test("ID 토큰 payload를 읽고, 형태가 아니면 null이다", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "abc", email: "kim@example.com" }), "utf8").toString("base64url");
  expect(decodeJwtPayload(`header.${payload}.signature`)).toEqual({ sub: "abc", email: "kim@example.com" });
  expect(decodeJwtPayload("not-a-token")).toBeNull();
  expect(decodeJwtPayload(`header.${Buffer.from("[]", "utf8").toString("base64url")}.sig`)).toBeNull();
});

// 운영자 화면에 보여줄 목록이다. 여기에 값이 섞이면 사번·전화번호가 설정 테이블에 쌓인다.
test("claimKeys는 이름만 돌려준다", () => {
  expect(claimKeys({ sub: "abc", email: "kim@example.com" })).toEqual(["email", "sub"]);
});

test("subject나 email이 없으면 신원을 만들지 않는다", () => {
  expect(resolveIdentity({ email: "kim@example.com" }, MAPPING)).toEqual({ ok: false, reason: "no_subject" });
  expect(resolveIdentity({ sub: "abc" }, MAPPING)).toEqual({ ok: false, reason: "no_email" });
});

// 계정 식별에 쓰는 email만 소문자로 눕힌다(users_email_lower_unique와 같은 기준).
// 이름 대신 쓰는 값은 IdP가 보낸 표기 그대로 둔다 — 이력에 남는 표시용이라
// 원문이 더 낫고, 계정을 찾는 데는 쓰이지 않는다.
test("이메일은 소문자로 눕히고, 이름이 없으면 이메일 표기를 그대로 쓴다", () => {
  const result = resolveIdentity({ sub: "abc", email: "Kim@Example.com" }, MAPPING);

  expect(result).toEqual({
    ok: true,
    identity: { subject: "abc", email: "kim@example.com", name: "Kim@Example.com", groups: [] },
  });
});

// 허용 목록을 비운 것은 "제한 없음"이지 "전원 차단"이 아니다. 반대로 만들면
// SSO를 켜는 순간 운영자 자신도 못 들어온다.
test("허용 그룹이 비어 있으면 전원 통과한다", () => {
  expect(decideAccess({ groups: [], allowedGroups: [], adminGroups: [] })).toEqual({ allowed: true, isAdmin: false });
});

test("그룹 비교는 대소문자를 가리지 않는다", () => {
  expect(
    decideAccess({ groups: ["Glossary-Editors"], allowedGroups: ["glossary-editors"], adminGroups: [] }),
  ).toEqual({ allowed: true, isAdmin: false });
  expect(decideAccess({ groups: ["other"], allowedGroups: ["glossary-editors"], adminGroups: [] })).toEqual({
    allowed: false,
    isAdmin: false,
  });
});

// 허용되지 않은 사람이 관리자 그룹에도 들어 있으면 "관리자지만 못 들어옴"이라는
// 앞뒤 안 맞는 상태가 된다. 통과하지 못하면 관리자도 아니다.
test("접근이 막히면 관리자 판정도 따라 꺼진다", () => {
  expect(decideAccess({ groups: ["ops"], allowedGroups: ["editors"], adminGroups: ["ops"] })).toEqual({
    allowed: false,
    isAdmin: false,
  });
  expect(decideAccess({ groups: ["ops"], allowedGroups: ["ops"], adminGroups: ["ops"] })).toEqual({
    allowed: true,
    isAdmin: true,
  });
});
