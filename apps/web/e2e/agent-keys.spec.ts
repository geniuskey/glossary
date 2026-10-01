import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { apiKeys, createDb, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("DATABASE_URL_TEST가 필요합니다.");
const db = createDb(databaseUrl);
const email = `e2e-agent-admin-${randomUUID()}@example.com`;
const password = "e2e-agent-key-password";
const agentName = `E2E Agent ${randomUUID()}`;

test.beforeAll(async () => {
  await db.insert(users).values({ email, name: "에이전트 관리자", role: "admin", passwordHash: await hashPassword(password) });
});

test.afterAll(async () => {
  const targets = await db.select({ id: users.id }).from(users).where(eq(users.name, agentName));
  if (targets.length) {
    const ids = targets.map((user) => user.id);
    await db.delete(apiKeys).where(inArray(apiKeys.createdBy, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await db.delete(users).where(eq(users.email, email));
});

test("관리자 화면에서 에이전트 키를 교체하고 재접속 후에도 폐기할 수 있다", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin?tab=users");
  await page.getByLabel("에이전트 이름").fill(agentName);
  await page.getByRole("button", { name: "편집자 계정 만들고 키 발급" }).click();
  const tokenDisplay = page.locator("section code");
  await expect(tokenDisplay).toHaveText(/^glk_/);
  const originalToken = (await tokenDisplay.textContent())!;
  const row = page.getByRole("row").filter({ hasText: agentName });
  await expect(row).toContainText("키 1개");
  await expect(row.getByRole("option", { name: "관리자", exact: true })).toBeDisabled();
  page.on("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "키 교체" }).click();
  await expect(tokenDisplay).not.toHaveText(originalToken);
  const newToken = (await tokenDisplay.textContent())!;
  expect((await request.get("/api/v1/terms", { headers: { authorization: `Bearer ${originalToken}` } })).status()).toBe(401);
  expect((await request.get("/api/v1/terms", { headers: { authorization: `Bearer ${newToken}` } })).status()).toBe(200);
  await page.reload();
  await expect(tokenDisplay).toHaveCount(0);
  await expect(row).toContainText("키 1개");
  await row.getByRole("button", { name: "키 폐기" }).click();
  await expect(row).toContainText("키 0개");
  expect((await request.get("/api/v1/terms", { headers: { authorization: `Bearer ${newToken}` } })).status()).toBe(401);
  await page.reload();
  await expect(row.getByRole("button", { name: "키 폐기" })).toBeDisabled();
});
