import { createDb, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

// 비밀번호는 argv로 받지 않는다 — Windows/리눅스 모두 프로세스 목록(예: Get-CimInstance
// Win32_Process, ps)에 커맨드라인이 그대로 노출되고 셸 히스토리에도 남는다.
// ADMIN_PASSWORD 환경변수로만 받는다.
const positional = process.argv.slice(2);
const [email, name] = positional;
const password = process.env.ADMIN_PASSWORD;

// R29(c)(Task 6 잔여): 예전 시그니처는 <email> <password> <name>이었다. 지금은
// <email> [name]이라, 누가 옛 명령을 그대로 치고 ADMIN_PASSWORD도 설정해 두면
// 세 번째 위치 인자(예전의 name, 지금은 버려지는 값이 아니라 옛 습관대로 실수로
// 넣은 비밀번호)가 users.name에 평문으로 저장될 수 있다. 위치 인자가 2개를
// 넘으면 그 자리에서 거부한다.
if (positional.length > 2) {
  console.error("usage: ADMIN_PASSWORD=<password> tsx scripts/seed-admin.ts <email> [name]");
  console.error(`위치 인자는 최대 2개(email, name)입니다. ${positional.length}개를 받았습니다.`);
  process.exit(1);
}

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
