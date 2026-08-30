import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createDb, workspaceSettings, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createSession, SESSION_COOKIE } from "../src/lib/auth/session.js";
import { DEFAULT_HOME_CONTENT } from "../src/lib/workspace/home-content-values.js";

let currentCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && currentCookieValue !== undefined ? { name, value: currentCookieValue } : undefined,
  }),
}));

const { GET: getHomeContent, PATCH: patchHomeContent } = await import(
  "../src/app/api/v1/admin/home-content/route.js"
);

const db = createDb(process.env.DATABASE_URL!);
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
  const [user] = await db
    .insert(users)
    .values({
      email: `home-content-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `홈 문구 ${role}`,
      passwordHash: await hashPassword("irrelevant-password"),
      role,
    })
    .returning();
  createdUserIds.push(user!.id);
  currentCookieValue = (await createSession(user!.id)).token;
  return user!;
}

function patchRequest(body: unknown) {
  return new Request("https://grossary.example.com/api/v1/admin/home-content", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("홈 문구 API는 비로그인 사용자와 편집자를 거부한다", async () => {
  currentCookieValue = undefined;
  expect((await getHomeContent()).status).toBe(401);

  await loginAs("editor");
  expect((await getHomeContent()).status).toBe(403);
  expect((await patchHomeContent(patchRequest(DEFAULT_HOME_CONTENT))).status).toBe(403);
});

test("설정 행이 없으면 기존 홈 기본 문구를 반환한다", async () => {
  await db.delete(workspaceSettings).where(eq(workspaceSettings.id, "default"));
  await loginAs("admin");

  const response = await getHomeContent();
  expect(response.status).toBe(200);
  expect((await response.json()).settings).toEqual(DEFAULT_HOME_CONTENT);
});

test("관리자는 조직과 특화 분야가 담긴 홈 문구를 저장하고 다시 읽는다", async () => {
  await loginAs("admin");
  const content = {
    eyebrow: "Imaging Platform Group",
    title: "카메라 ISP와 영상처리에 특화된\n우리 조직의 용어집.",
    description: "프로젝트에서 사용하는 약어와 영상 품질 개념을 함께 정리합니다.",
  };

  const saved = await patchHomeContent(patchRequest(content));
  expect(saved.status).toBe(200);
  expect((await saved.json()).settings).toEqual(content);

  const read = await getHomeContent();
  expect((await read.json()).settings).toEqual(content);
});

test("홈 문구 수정은 빈 값·길이 초과·알 수 없는 필드를 받지 않는다", async () => {
  await loginAs("admin");
  expect((await patchHomeContent(patchRequest({ ...DEFAULT_HOME_CONTENT, title: "   " }))).status).toBe(400);
  expect((await patchHomeContent(patchRequest({ ...DEFAULT_HOME_CONTENT, eyebrow: "x".repeat(49) }))).status).toBe(400);
  expect((await patchHomeContent(patchRequest({ ...DEFAULT_HOME_CONTENT, extra: "no" }))).status).toBe(400);
});
