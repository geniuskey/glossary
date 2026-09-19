import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, users, workspaceSettings } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { DEFAULT_WORKSPACE_MENU_SETTINGS } from "../src/lib/workspace/menu-settings-values.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => name === SESSION_COOKIE && currentCookieValue
      ? { name, value: currentCookieValue }
      : undefined,
  }),
}));

const { GET, PATCH } = await import("../src/app/api/v1/admin/menu-settings/route.js");
const db = createDb(process.env.DATABASE_URL_TEST!);
const createdUserIds: string[] = [];
let originalSetting: typeof workspaceSettings.$inferSelect | undefined;

beforeAll(async () => {
  [originalSetting] = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, "default")).limit(1);
});

afterAll(async () => {
  await db.delete(workspaceSettings).where(eq(workspaceSettings.id, "default"));
  if (originalSetting) await db.insert(workspaceSettings).values(originalSetting);
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

async function loginAs(role: "admin" | "editor") {
  const [user] = await db.insert(users).values({
    email: `menu-settings-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `메뉴 설정 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function patchRequest(body: unknown) {
  return new Request("https://glossary.example.com/api/v1/admin/menu-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("메뉴 설정 API는 비로그인 사용자와 편집자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await GET()).status).toBe(401);
  await loginAs("editor");
  expect((await GET()).status).toBe(403);
  expect((await PATCH(patchRequest(DEFAULT_WORKSPACE_MENU_SETTINGS))).status).toBe(403);
});

test("설정 행이 없으면 모든 기존 메뉴를 기본으로 표시한다", async () => {
  await db.delete(workspaceSettings).where(eq(workspaceSettings.id, "default"));
  await loginAs("admin");
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).settings).toEqual(DEFAULT_WORKSPACE_MENU_SETTINGS);
});

test("관리자는 부가 메뉴를 끄고 다시 읽을 수 있다", async () => {
  await loginAs("admin");
  const settings = { ...DEFAULT_WORKSPACE_MENU_SETTINGS, meetings: false, wiki: false, chat: false };
  const saved = await PATCH(patchRequest(settings));
  expect(saved.status).toBe(200);
  expect((await saved.json()).settings).toEqual(settings);
  expect((await (await GET()).json()).settings).toEqual(settings);
});

test("기본 시트는 끌 수 없고 알 수 없는 필드를 받지 않는다", async () => {
  await loginAs("admin");
  expect((await PATCH(patchRequest({ ...DEFAULT_WORKSPACE_MENU_SETTINGS, sheet: false }))).status).toBe(400);
  expect((await PATCH(patchRequest({ ...DEFAULT_WORKSPACE_MENU_SETTINGS, extra: false }))).status).toBe(400);
});
