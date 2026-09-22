import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb, terms, unregisteredCandidates, users } from "@glossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

const email = "e2e-journey@example.com";
const password = "e2e-journey-password";
const slug = "e2e-journey-term";
const nameEn = "E2E Journey Term";
const nameKo = "E2E 여정 용어";
const alias = "E2EJT";
const candidate = "ZXQ99";
const originalDefinition = "브라우저 핵심 흐름을 검증하기 위한 용어입니다.";
const updatedDefinition = "수정 이력과 되돌리기까지 검증하기 위해 바꾼 정의입니다.";

const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) throw new Error("DATABASE_URL_TEST가 필요합니다.");
const db = createDb(databaseUrl);

async function cleanJourneyData() {
  await db.delete(unregisteredCandidates).where(eq(unregisteredCandidates.text, candidate));
  await db.delete(terms).where(eq(terms.slug, slug));
  await db.delete(users).where(eq(users.email, email));
}

test.beforeAll(async () => {
  await cleanJourneyData();
  await db.insert(users).values({
    email,
    name: "E2E 관리자",
    passwordHash: await hashPassword(password),
    role: "admin",
  });
});

test.afterAll(async () => {
  await cleanJourneyData();
});

test("용어 등록부터 별칭 검색, 문서 점검과 이력 되돌리기까지 이어진다", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/new");
  await page.getByLabel("대표 영문 용어").fill(nameEn);
  await page.getByLabel("대표 국문 용어").fill(nameKo);
  await page.getByRole("textbox", { name: "한줄 정의", exact: true }).fill(originalDefinition);
  await page.getByText("+ 추가 표기", { exact: true }).click();
  await page.getByLabel("한 번에 추가").fill(alias);
  await page.getByRole("button", { name: "표기 추가" }).click();
  await page.getByRole("button", { name: "용어 저장" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${slug}$`));
  await expect(page.getByText(originalDefinition)).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "대표 표기 복사" }).click();
  await expect(page.getByRole("status")).toContainText("복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(nameEn);
  await page.screenshot({ path: "test-results/design-term-desktop.png", fullPage: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "최근 다듬은 용어" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`${nameEn}.*뜻 살펴보기`) })).toBeVisible();
  await page.screenshot({ path: "test-results/design-home-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/design-home-mobile.png", fullPage: true });
  await page.goto("/sheet");
  await expect(page.getByRole("textbox", { name: "현재 시트에서 검색" })).toBeVisible();
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  await expect(page.getByRole("button", { name: "CSV 파일로 저장" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/design-sheet-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  await page.screenshot({ path: "test-results/design-sheet-desktop.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.screenshot({ path: "test-results/design-home-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("용어 검색").fill(alias);
  await page.getByLabel("용어 검색").press("Enter");
  await expect(page.getByRole("link", { name: new RegExp(nameEn) })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(nameEn) }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${slug}\\?from=`));

  await page.goto("/check");
  await page.getByLabel("문서 이름·출처").fill("E2E 온보딩 문서");
  await page.getByLabel("문서 본문").fill(`${nameKo}에서 ${candidate}를 사용합니다.`);
  await page.getByRole("button", { name: "문서 점검", exact: true }).click();
  await expect(page.getByText("미등록 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: candidate })).toBeVisible();

  await page.goto(`/edit/${slug}`);
  await page.getByRole("textbox", { name: "한줄 정의", exact: true }).fill(updatedDefinition);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByText("변경사항을 저장했습니다. 정리 상태는 시스템이 자동으로 판정합니다.")).toBeVisible();

  await page.goto(`/history/${slug}`);
  await expect(page.getByText("리비전 2개")).toBeVisible();
  await page.getByRole("button", { name: "이 버전으로 되돌리기" }).click();
  await expect(page.getByText("리비전 3개")).toBeVisible();

  await page.goto(`/g/${slug}`);
  await expect(page.getByText(originalDefinition)).toBeVisible();
  await expect(page.getByText(updatedDefinition)).toHaveCount(0);
});
