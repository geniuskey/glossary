import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { apiKeys, createDb, sessions, ssoConfig, ssoWithdrawals, terms, users } from "@glossary/db";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { ssoSubjectHash } from "../src/lib/auth/account-policy.js";
import { changeManagedUserRole, createManagedAgentUser, listManagedUsers, manageAgentKeys } from "../src/lib/admin/users.js";
import { deleteOwnAccount } from "../src/lib/auth/delete-account.js";
import { getCurrentUser } from "../src/lib/auth/current-user.js";
import { requireAuth } from "../src/lib/auth/require.js";
import { applySsoLogin } from "../src/lib/auth/sso/login.js";
import { hashPassword } from "../src/lib/auth/password.js";

let sessionToken: string | undefined;
let proxyHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => proxyHeaders,
  cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && sessionToken ? { value: sessionToken } : undefined }),
}));

const { POST: rotateKeys, DELETE: revokeKeys } = await import("../src/app/api/v1/admin/users/[id]/keys/route.js");
const { PATCH: patchRole } = await import("../src/app/api/v1/admin/users/[id]/route.js");
const { DELETE: deleteAccount } = await import("../src/app/api/v1/account/route.js");
const { POST: rejoinProxy } = await import("../src/app/auth/sso/proxy-rejoin/route.js");
const { default: LoginPage } = await import("../src/app/login/page.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const userIds: string[] = [];
const termIds: string[] = [];
const withdrawalHashes: string[] = [];
let originalSsoConfig: typeof ssoConfig.$inferSelect | undefined;
let changedConfig = false;

afterEach(async () => {
  if (termIds.length) await db.delete(terms).where(inArray(terms.id, termIds.splice(0)));
  if (userIds.length) {
    await db.delete(apiKeys).where(inArray(apiKeys.createdBy, userIds));
    await db.delete(users).where(inArray(users.id, userIds.splice(0)));
  }
  if (withdrawalHashes.length) await db.delete(ssoWithdrawals).where(inArray(ssoWithdrawals.subjectHash, withdrawalHashes.splice(0)));
  if (changedConfig) {
    if (originalSsoConfig) await db.update(ssoConfig).set(originalSsoConfig).where(eq(ssoConfig.id, "default"));
    else await db.delete(ssoConfig).where(eq(ssoConfig.id, "default"));
    changedConfig = false;
  }
  sessionToken = undefined;
  proxyHeaders = new Headers();
  vi.unstubAllEnvs();
});

async function person(role: "admin" | "editor" | "viewer" = "editor") {
  const [user] = await db.insert(users).values({
    email: `${randomUUID()}@example.com`, name: "사람", role,
    passwordHash: await hashPassword("correct-password"),
  }).returning();
  userIds.push(user!.id);
  return user!;
}

async function agent() {
  const created = await createManagedAgentUser({ name: "리뷰 에이전트" });
  userIds.push(created.user.id);
  return created;
}

function context(id: string) { return { params: Promise.resolve({ id }) }; }
function keyRequest(token: string) { return new Request("https://glossary.example.com", { headers: { authorization: `Bearer ${token}` } }); }

test("관리자는 에이전트 키를 교체·폐기하고 이전 키는 더 이상 인증되지 않는다", async () => {
  const admin = await person("admin");
  sessionToken = (await createSession(admin.id)).token;
  const created = await agent();
  expect((await requireAuth(keyRequest(created.key.token), "read"))).not.toBeInstanceOf(Response);
  const response = await rotateKeys(new Request("https://glossary.example.com", { method: "POST" }), context(created.user.id));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.revoked).toBe(1);
  expect((await requireAuth(keyRequest(created.key.token), "read")) as Response).toHaveProperty("status", 401);
  expect((await requireAuth(keyRequest(body.key.token), "write"))).not.toBeInstanceOf(Response);
  expect((await listManagedUsers()).find((user) => user.id === created.user.id)?.activeApiKeys).toBe(1);
  const revoked = await revokeKeys(new Request("https://glossary.example.com", { method: "DELETE" }), context(created.user.id));
  expect(await revoked.json()).toEqual({ revoked: 1, key: null });
  expect((await requireAuth(keyRequest(body.key.token), "read")) as Response).toHaveProperty("status", 401);
  const repeated = await revokeKeys(new Request("https://glossary.example.com", { method: "DELETE" }), context(created.user.id));
  expect(await repeated.json()).toEqual({ revoked: 0, key: null });
  expect((await listManagedUsers()).find((user) => user.id === created.user.id)?.activeApiKeys).toBe(0);
});

test("키 관리 API는 관리자와 에이전트 대상만 허용하고 뷰어 키는 쓰기 scope를 받지 않는다", async () => {
  const editor = await person();
  const created = await agent();
  const request = new Request("https://glossary.example.com", { method: "POST" });
  expect((await rotateKeys(request, context(created.user.id))).status).toBe(401);
  sessionToken = (await createSession(editor.id)).token;
  expect((await rotateKeys(request, context(created.user.id))).status).toBe(403);
  const admin = await person("admin");
  sessionToken = (await createSession(admin.id)).token;
  expect((await rotateKeys(request, context(editor.id))).status).toBe(403);
  expect((await rotateKeys(request, context("invalid"))).status).toBe(404);
  await changeManagedUserRole(admin.id, created.user.id, "viewer");
  const rotated = await rotateKeys(request, context(created.user.id));
  expect((await rotated.json()).key.scopes).toEqual(["read", "validate"]);
  const [oldKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.key.id));
  expect(oldKey?.revokedAt).not.toBeNull();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GLOSSARY_ALLOWED_ORIGINS", "https://glossary.example.com");
  const crossSite = new Request("https://glossary.example.com", { method: "DELETE", headers: { origin: "https://attacker.example.com" } });
  expect((await revokeKeys(crossSite, context(created.user.id))).status).toBe(403);
  expect((await manageAgentKeys(editor.id, created.user.id, false))).toEqual({ ok: false, reason: "actor_forbidden" });
});

test("에이전트 관리자 승격을 차단하고 기존 에이전트 관리자도 마지막 사람 관리자 검사에서 제외한다", async () => {
  const admin = await person("admin");
  const created = await agent();
  sessionToken = (await createSession(admin.id)).token;
  const response = await patchRole(new Request("https://glossary.example.com", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }),
  }), context(created.user.id));
  expect(response.status).toBe(409);
  await db.update(users).set({ role: "admin" }).where(eq(users.id, created.user.id));
  expect(await deleteOwnAccount(admin.id, admin.email)).toEqual({ ok: false, reason: "last_admin" });
  expect(await changeManagedUserRole(admin.id, created.user.id, "editor")).toEqual({ ok: true });
});

test("탈퇴는 비밀번호를 확인하고 세션·키·용어 작성자 연결을 정리하며 다른 작성자 연결은 보존한다", async () => {
  const user = await person();
  const other = await person();
  sessionToken = (await createSession(user.id)).token;
  const [term] = await db.insert(terms).values({ slug: randomUUID(), nameEn: "Lifecycle", ownerId: user.id, createdBy: user.id, updatedBy: other.id }).returning();
  termIds.push(term!.id);
  const { generateApiKey } = await import("../src/lib/auth/api-key.js");
  const key = generateApiKey();
  await db.insert(apiKeys).values({ name: "탈퇴 키", prefix: key.prefix, keyHash: key.hash, scopes: ["read"], createdBy: user.id });
  const request = (password: string) => new Request("https://glossary.example.com", {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmEmail: user.email, password }),
  });
  expect((await deleteAccount(request("wrong-password"))).status).toBe(403);
  const response = await deleteAccount(request("correct-password"));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
  expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
  expect(await db.select().from(apiKeys).where(eq(apiKeys.createdBy, user.id))).toHaveLength(0);
  const [savedTerm] = await db.select().from(terms).where(eq(terms.id, term!.id));
  expect(savedTerm).toMatchObject({ ownerId: null, createdBy: null, updatedBy: other.id });
});

test("작성자 외래 키는 직접 삭제 시에도 연결을 제거하고 존재하지 않는 작성자를 거부한다", async () => {
  const user = await person();
  const [term] = await db.insert(terms).values({ slug: randomUUID(), nameEn: "FK", createdBy: user.id, updatedBy: user.id }).returning();
  termIds.push(term!.id);
  await db.delete(users).where(eq(users.id, user.id));
  const [saved] = await db.select().from(terms).where(eq(terms.id, term!.id));
  expect(saved).toMatchObject({ createdBy: null, updatedBy: null });
  await expect(db.update(terms).set({ createdBy: randomUUID() }).where(eq(terms.id, term!.id))).rejects.toThrow();
});

test("프록시 탈퇴 계정은 자동 로그인·다른 요청에서도 생성되지 않고 명시적 재가입만 허용한다", async () => {
  await person("admin");
  vi.stubEnv("OAUTH2_PROXY_ENABLED", "true");
  [originalSsoConfig] = await db.select().from(ssoConfig).where(eq(ssoConfig.id, "default"));
  changedConfig = true;
  const cfg = { mode: "oauth2-proxy" as const, passwordLoginEnabled: false, autoCreate: true, allowedGroups: [], adminGroups: [] };
  await db.insert(ssoConfig).values(cfg).onConflictDoUpdate({ target: ssoConfig.id, set: cfg });
  const email = `${randomUUID()}@example.com`;
  const identity = { subject: email, email, name: "탈퇴 SSO", groups: [] };
  withdrawalHashes.push(ssoSubjectHash(identity.subject));
  const created = await applySsoLogin({ identity, isAdmin: false, autoCreate: true });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  userIds.push(created.user.id);
  expect(await deleteOwnAccount(created.user.id, email)).toEqual({ ok: true });
  proxyHeaders = new Headers({ "x-forwarded-email": email });
  expect(await getCurrentUser()).toBeNull();
  expect(await applySsoLogin({ identity, isAdmin: false, autoCreate: true, automatic: true })).toEqual({ ok: false, reason: "no_account" });
  const page = await LoginPage({ searchParams: Promise.resolve({}) });
  expect(page).toBeDefined(); // A regression would redirect to /oauth2/start here.
  const { renderToStaticMarkup } = await import("react-dom/server");
  expect(renderToStaticMarkup(page)).toContain('action="/auth/sso/proxy-rejoin"');
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GLOSSARY_ALLOWED_ORIGINS", "https://glossary.example.com");
  const rejoin = (origin: string) => new Request("https://glossary.example.com/auth/sso/proxy-rejoin", {
    method: "POST", headers: { "x-forwarded-email": email, origin },
  });
  expect((await rejoinProxy(rejoin("https://attacker.example.com"))).headers.get("location")).toBe("/login?sso=state");
  expect(await getCurrentUser()).toBeNull();
  await db.update(ssoConfig).set({ allowedGroups: ["restricted"] }).where(eq(ssoConfig.id, "default"));
  expect((await rejoinProxy(rejoin("https://glossary.example.com"))).headers.get("location")).toBe("/login?sso=not_allowed");
  await db.update(ssoConfig).set({ allowedGroups: [], autoCreate: false }).where(eq(ssoConfig.id, "default"));
  expect((await rejoinProxy(rejoin("https://glossary.example.com"))).headers.get("location")).toBe("/login?sso=no_account");
  await db.update(ssoConfig).set({ autoCreate: true }).where(eq(ssoConfig.id, "default"));
  const response = await rejoinProxy(rejoin("https://glossary.example.com"));
  expect(response.headers.get("location")).toBe("/");
  const user = await getCurrentUser();
  expect(user?.role).toBe("viewer");
  expect(user?.id).not.toBe(created.user.id);
  if (user) userIds.push(user.id);
  expect(await db.select().from(ssoWithdrawals).where(eq(ssoWithdrawals.subjectHash, ssoSubjectHash(identity.subject)))).toHaveLength(0);
});

test("탈퇴와 동시 프록시 인증도 최종 계정 재생성을 남기지 않는다", async () => {
  const identity = { subject: randomUUID(), email: `${randomUUID()}@example.com`, name: "경쟁 조건", groups: [] };
  withdrawalHashes.push(ssoSubjectHash(identity.subject));
  const created = await applySsoLogin({ identity, isAdmin: false, autoCreate: true });
  if (!created.ok) throw new Error("SSO setup failed");
  userIds.push(created.user.id);
  await Promise.all([
    deleteOwnAccount(created.user.id, identity.email),
    applySsoLogin({ identity, isAdmin: false, autoCreate: true, automatic: true }),
  ]);
  expect(await db.select().from(users).where(eq(users.externalId, identity.subject))).toHaveLength(0);
  expect(await applySsoLogin({ identity, isAdmin: false, autoCreate: true, automatic: true })).toEqual({ ok: false, reason: "no_account" });
});
