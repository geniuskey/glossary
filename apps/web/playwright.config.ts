import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // CI supplies DATABASE_URL_TEST directly.
}

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. E2E는 개발 DB를 사용하지 않습니다.");
}

const baseURL = "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start:e2e",
    url: `${baseURL}/login`,
    env: {
      DATABASE_URL: testDatabaseUrl,
      DATABASE_URL_TEST: testDatabaseUrl,
      GLOSSARY_ALLOWED_ORIGINS: baseURL,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
