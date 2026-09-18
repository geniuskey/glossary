import path from "node:path";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // CI and callers without a local .env provide the URL through the environment.
}

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is required. DB tests never use the development database.");
}
