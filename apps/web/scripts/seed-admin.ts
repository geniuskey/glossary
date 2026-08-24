import { createDb, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

// 비밀번호는 argv로 받지 않는다 — Windows/리눅스 모두 프로세스 목록(예: Get-CimInstance
// Win32_Process, ps)에 커맨드라인이 그대로 노출되고 셸 히스토리에도 남는다.
// ADMIN_PASSWORD 환경변수로만 받는다.
const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error("usage: ADMIN_PASSWORD=<password> tsx scripts/seed-admin.ts <email> [name]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL!);

try {
  await db.insert(users).values({
    email,
    name: name ?? email,
    passwordHash: await hashPassword(password),
    role: "admin",
  });
  console.log(`admin created: ${email}`);
  process.exit(0);
} catch (err) {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") {
    console.error(`이미 존재하는 이메일입니다: ${email}`);
    process.exit(1);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`관리자 계정 생성 실패: ${message}`);
  process.exit(1);
}
