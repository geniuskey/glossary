import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createDb, ssoConfig } from "@grossary/db";
import {
  discoverOidc,
  discoveryUrl,
  loadSsoConfig,
  publicSsoConfig,
  readDiscovery,
  saveSsoConfig,
  SSO_CONFIG_ID,
  validateSsoConfig,
  type SsoConfig,
} from "../src/lib/auth/sso/config.js";

const db = createDb(process.env.DATABASE_URL!);

// sso_config는 행이 하나뿐인 테이블이라(체크 제약) 이 파일은 그 한 행을 고쳤다가
// 되돌린다. vitest.config.ts가 파일 병렬 실행을 꺼 둬서 다른 파일과 겹치지 않는다.
let original: SsoConfig;

beforeAll(async () => {
  original = await loadSsoConfig();
});

afterAll(async () => {
  await db.update(ssoConfig).set(original).where(eq(ssoConfig.id, SSO_CONFIG_ID));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const READY = {
  enabled: true,
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  clientId: "grossary",
  clientSecret: "s3cr3t",
};

test("꺼져 있으면 아무것도 요구하지 않는다", () => {
  expect(validateSsoConfig({ ...original, enabled: false })).toEqual([]);
});

// 빈 설정으로 enabled만 켜면 로그인 화면에 버튼이 생기고, 누른 사람은 IdP 대신
// 에러로 튕긴다 — 그 실패는 운영자가 아니라 사용자에게 먼저 보인다.
test("켤 때 빠진 값은 이름을 붙여 돌려준다", () => {
  const problems = validateSsoConfig({ ...original, enabled: true });

  expect(problems.length).toBeGreaterThan(0);
  expect(problems.join(" ")).toContain("클라이언트 ID");
  expect(validateSsoConfig({ ...original, ...READY })).toEqual([]);
});

// 그룹을 읽지 못하면 관리자 그룹은 영원히 아무에게도 걸리지 않는다 — 에러 없이 조용히.
test("그룹 claim 없이 관리자 그룹만 지정하면 막는다", () => {
  const problems = validateSsoConfig({ ...original, ...READY, groupClaims: [], adminGroups: ["ops"] });

  expect(problems.join(" ")).toContain("그룹 claim");
});

test("바깥으로 나가는 설정에는 시크릿이 없고 있는지 여부만 있다", () => {
  const view = publicSsoConfig({ ...original, clientSecret: "s3cr3t" });

  expect(view).not.toHaveProperty("clientSecret");
  expect(view.hasClientSecret).toBe(true);
  expect(publicSsoConfig({ ...original, clientSecret: "" }).hasClientSecret).toBe(false);
});

test("설정을 저장하면 그대로 읽힌다", async () => {
  const result = await saveSsoConfig({ ...READY, nameClaims: ["displayName", "name"] }, null);

  expect(result.ok).toBe(true);
  const saved = await loadSsoConfig();
  expect(saved.nameClaims).toEqual(["displayName", "name"]);
  expect(saved.enabled).toBe(true);
});

// 설정 화면은 시크릿을 되받지 못해 언제나 빈 칸으로 열린다. 그 빈 칸을 저장으로
// 반영하면 버튼 문구 하나 고칠 때마다 SSO가 조용히 꺼진다.
test("빈 문자열 시크릿은 저장된 값을 지우지 않는다", async () => {
  await saveSsoConfig(READY, null);

  const result = await saveSsoConfig({ clientSecret: "", buttonLabel: "사내 계정" }, null);

  expect(result.ok).toBe(true);
  const saved = await loadSsoConfig();
  expect(saved.clientSecret).toBe("s3cr3t");
  expect(saved.buttonLabel).toBe("사내 계정");
});

test("시크릿을 지우려면 null을 보내야 하고, 켜져 있으면 거절된다", async () => {
  await saveSsoConfig(READY, null);

  const result = await saveSsoConfig({ clientSecret: null }, null);

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.problems.join(" ")).toContain("클라이언트 시크릿");
  // 거절된 저장은 아무것도 바꾸지 않는다.
  expect((await loadSsoConfig()).clientSecret).toBe("s3cr3t");
});

test("발견 문서에서 필요한 것만 꺼내고, 엔드포인트가 없으면 null이다", () => {
  const doc = {
    issuer: "https://idp.example.com",
    authorization_endpoint: "https://idp.example.com/authorize",
    token_endpoint: "https://idp.example.com/token",
    userinfo_endpoint: "https://idp.example.com/userinfo",
    claims_supported: ["sub", "email", 42, "preferred_username"],
    jwks_uri: "https://idp.example.com/jwks",
  };

  expect(readDiscovery(doc)).toEqual({
    issuer: "https://idp.example.com",
    authorizationEndpoint: "https://idp.example.com/authorize",
    tokenEndpoint: "https://idp.example.com/token",
    userinfoEndpoint: "https://idp.example.com/userinfo",
    scopesSupported: [],
    claimsSupported: ["sub", "email", "preferred_username"],
  });
  expect(readDiscovery({ issuer: "https://idp.example.com" })).toBeNull();
  expect(readDiscovery(null)).toBeNull();
});

// issuer 끝의 /를 그대로 두면 //.well-known이 되어 404를 주는 IdP가 있다.
test("발견 URL은 issuer 끝의 슬래시를 먹는다", () => {
  expect(discoveryUrl("https://idp.example.com/realms/co/")).toBe(
    "https://idp.example.com/realms/co/.well-known/openid-configuration",
  );
});

test("발견 요청이 실패하면 null이다", async () => {
  vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));

  expect(await discoverOidc("https://idp.example.com")).toBeNull();
});
