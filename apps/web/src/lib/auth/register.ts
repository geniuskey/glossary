import { users } from "@glossary/db";
import { isUniqueViolation } from "@/lib/postgres-error";
import { getDb } from "@/lib/db";
import { hashPassword } from "./password";

/**
 * 로그인 화면에서 사용자가 계정을 만든다. 신규 계정은 읽기 전용으로 시작하고,
 * 관리자가 편집 권한을 부여한 뒤에 glossary 데이터를 바꿀 수 있다.
 *
 * 역할은 언제나 `viewer`다. 여기서 role을 입력으로 받으면 가입 폼에 필드 하나
 * 추가하는 것으로 누구나 관리자나 편집자가 될 수 있다.
 */
export type RegisterResult =
  | { ok: true; user: { id: string; email: string; name: string; role: "admin" | "editor" | "viewer" } }
  | { ok: false; reason: "email_taken" };

/** 표시용 원문은 사람이 친 그대로 두고, 저장·조회 키만 소문자로 맞춘다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// R48과 같은 판별 패턴: postgres-js는 SQLSTATE를 `.code`, 위반한 제약 이름을
// `.constraint_name`으로 싣는다. 이메일 유니크 위반만 "이미 쓰는 이메일"로
// 옮기고, 다른 23505는 진짜 무결성 문제이므로 그대로 던져 500이 되게 둔다.
const EMAIL_CONSTRAINTS = new Set(["users_email_unique", "users_email_lower_unique"]);

function isEmailTaken(err: unknown): boolean {
  return isUniqueViolation(err, [...EMAIL_CONSTRAINTS]);
}

/**
 * 중복 확인을 "select 먼저, insert 나중"으로 하지 않는다. 두 사람이 같은 이메일로
 * 동시에 가입하면 둘 다 select에서 0건을 보고 둘 다 insert로 넘어간다 — 유일성을
 * 실제로 지키는 건 유니크 인덱스뿐이므로, 그 인덱스가 던지는 23505를 잡는다.
 */
export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email);

  try {
    const [created] = await getDb()
      .insert(users)
      .values({ email, name: input.name.trim() || email, passwordHash, role: "viewer" })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    if (!created) throw new Error("계정 생성에 실패했습니다.");
    return { ok: true, user: created };
  } catch (err) {
    if (isEmailTaken(err)) return { ok: false, reason: "email_taken" };
    throw err;
  }
}
