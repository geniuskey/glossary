import path from "node:path";
import { defineConfig } from "drizzle-kit";

// 로컬에서는 저장소 루트 .env를 읽고, CI에서는 명시적으로 주어진 값을 쓴다.
try {
  process.loadEnvFile(path.join(process.cwd(), "../../.env"));
} catch {
  /* CI: 셸 환경변수 사용 */
}

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. 테스트 마이그레이션은 개발 DB를 사용하지 않습니다.");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: testUrl },
});
