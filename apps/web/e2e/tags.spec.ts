import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb, terms, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

const email = "e2e-tags@example.com";
const password = "e2e-tags-password";
const slug = "e2e-tags-term";
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("DATABASE_URL_TEST가 필요합니다.");
const db = createDb(databaseUrl);

async function clean() {
  await db.delete(terms).where(eq(terms.slug, slug));
  await db.delete(users).where(eq(users.email, email));
}

test.beforeAll(async () => {
  await clean();
  await db.insert(users).values({
    email,
    name: "태그 테스트 관리자",
    passwordHash: await hashPassword(password),
    role: "admin",
  });
});

test.afterAll(clean);

test("태그를 여러 개 등록하고 편집·필터에 재사용한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/new");
  await page.getByLabel("대표 영문 용어").fill("E2E Tags Term");
  await page.getByText("부가 정보", { exact: true }).click();
  await page.getByLabel("태그 입력").fill("브라우저, 테스트");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByRole("list", { name: "태그 목록" })).toContainText("#브라우저");
  await expect(page.getByRole("list", { name: "태그 목록" })).toContainText("#테스트");
  await page.getByRole("button", { name: "용어 저장" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${slug}$`));
  await expect(page.getByText("#브라우저")).toBeVisible();
  await expect(page.getByText("#테스트")).toBeVisible();

  await page.goto("/sheet?tag=테스트");
  await expect(page.getByText("E2E Tags Term")).toBeVisible();

  await page.goto(`/edit/${slug}`);
  await page.getByRole("button", { name: "브라우저 태그 삭제" }).click();
  await page.getByLabel("태그 입력").fill("검증");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByText("변경사항을 저장했습니다. 정리 상태는 시스템이 자동으로 판정합니다.")).toBeVisible();
  await page.goto(`/g/${slug}`);
  await expect(page.getByText("#브라우저")).toHaveCount(0);
  await expect(page.getByText("#테스트")).toBeVisible();
  await expect(page.getByText("#검증")).toBeVisible();

  await page.goto(`/history/${slug}`);
  await page.getByRole("button", { name: "이 버전으로 되돌리기" }).click();
  await expect(page.getByText("리비전 3개")).toBeVisible();
  await page.goto(`/g/${slug}`);
  await expect(page.getByText("#브라우저")).toBeVisible();
  await expect(page.getByText("#테스트")).toBeVisible();
  await expect(page.getByText("#검증")).toHaveCount(0);
});
