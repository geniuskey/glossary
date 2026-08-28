import path from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit은 .env를 자동으로 읽지 않고 이 설정을 CJS로 번들해 실행한다
// (그래서 import.meta.dirname은 여기서 undefined다). config는 언제나 이 패키지
// 디렉터리(packages/db)를 cwd로 실행되므로 거기서 모노레포 루트의 .env를 로드해
// DATABASE_URL을 채운다. 파일이 없으면(운영·CI) 컨테이너/셸 env를 그대로 쓴다.
try {
  process.loadEnvFile(path.join(process.cwd(), "../../.env"));
} catch {
  /* 운영·CI: 컨테이너/셸 env 사용 */
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
