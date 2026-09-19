import { expect, test } from "@playwright/test";

test("로그인 진입점이 브라우저에서 렌더링된다", async ({ page }) => {
  const response = await page.goto("/login", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).toContainText("Glossary");
  await expect(page).toHaveURL(/\/(login|setup)(\?.*)?$/);
});
