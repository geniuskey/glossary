import path from "node:path";

// Vitest does not load the repository root .env by itself. Load it here so the
// documented `cp .env.example .env && pnpm test` flow is reproducible, while
// preserving CI/explicit shell values when they are already present.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // CI and callers without a local .env provide the URL through the environment.
}

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. 테스트는 개발 DB에 붙지 않습니다.");
}
process.env.DATABASE_URL = testUrl;
