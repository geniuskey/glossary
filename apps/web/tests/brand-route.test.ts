import { eq, sql } from "drizzle-orm";
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

const { GET, PATCH } = await import("../src/app/api/v1/admin/brand/route.js");
const menuRoute = await import("../src/app/api/v1/admin/menu-settings/route.js");
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
    email: `brand-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    name: `대표 색 ${role}`,
    passwordHash: await hashPassword("irrelevant-password"),
    role,
  }).returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
}

function patchRequest(url: string, body: unknown) {
  return new Request(`https://glossary.example.com${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("대표 색 API는 비로그인 사용자와 편집자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await GET()).status).toBe(401);
  await loginAs("editor");
  expect((await GET()).status).toBe(403);
  expect((await PATCH(patchRequest("/api/v1/admin/brand", { preset: "ink" }))).status).toBe(403);
});

test("관리자는 프리셋을 저장하고, 목록에 없는 값은 거부된다", async () => {
  await loginAs("admin");
  const saved = await PATCH(patchRequest("/api/v1/admin/brand", { preset: "ink" }));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ preset: "ink" });
  expect(await (await GET()).json()).toEqual({ preset: "ink" });

  const invalid = await PATCH(patchRequest("/api/v1/admin/brand", { preset: "purple" }));
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error.code).toBe("validation_failed");
});

test("대표 색을 모르는 메뉴 저장 요청은 저장된 프리셋을 지우지 않는다", async () => {
  await loginAs("admin");
  await PATCH(patchRequest("/api/v1/admin/brand", { preset: "teal" }));
  const { brandPreset: _omitted, ...menuOnly } = DEFAULT_WORKSPACE_MENU_SETTINGS;
  const menu = await menuRoute.PATCH(patchRequest("/api/v1/admin/menu-settings", { ...menuOnly, graph: false }));
  expect(menu.status).toBe(200);
  expect(await (await GET()).json()).toEqual({ preset: "teal" });
});

test("DB에 남은 알 수 없는 프리셋은 기본 색으로 읽는다", async () => {
  await loginAs("admin");
  await db.update(workspaceSettings)
    .set({ menuSettings: sql`jsonb_set(menu_settings, '{brandPreset}', '"purple"')` })
    .where(eq(workspaceSettings.id, "default"));
  expect(await (await GET()).json()).toEqual({ preset: DEFAULT_WORKSPACE_MENU_SETTINGS.brandPreset });
});
