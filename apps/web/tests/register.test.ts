import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, users } from "@grossary/db";
import { POST as registerPost } from "../src/app/api/v1/auth/register/route.js";
import { POST as loginPost } from "../src/app/api/v1/auth/login/route.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { SESSION_COOKIE } from "../src/lib/auth/session.js";

const db = createDb(process.env.DATABASE_URL!);
const createdUserIds: string[] = [];

// 가입 창구는 계정이 하나도 없으면 403이다(첫 계정은 /setup이 관리자로 만든다).
// 테스트 DB는 다른 파일이 자기 사용자를 지우고 나가므로 비어 있을 수 있어,
// 여기서 관리자 한 명을 먼저 심어 "설정이 끝난 설치"를 만든다.
beforeAll(async () => {
  const [row] = await db
    .insert(users)
    .values({
      email: `register-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "설치 관리자",
      passwordHash: await hashPassword("irrelevant"),
      role: "admin",
    })
    .returning({ id: users.id });
  createdUserIds.push(row!.id);
});

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
});

function uniqueEmail(prefix = "signup") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function postRequest(path: string, body: unknown) {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function register(body: unknown) {
  const res = await registerPost(postRequest("/api/v1/auth/register", body));
  if (res.status === 200) {
    const clone = await res.clone().json();
    createdUserIds.push(clone.user.id);
  }
  return res;
}

test("누구나 계정을 만들 수 있고 곧바로 세션 쿠키를 받는다", async () => {
  const email = uniqueEmail();

  const res = await register({ email, password: "hunter2hunter2", name: "가입자" });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.email).toBe(email);
  expect(body.user.name).toBe("가입자");
  expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  expect(res.headers.get("set-cookie")).toContain("HttpOnly");
});

// 가입 폼에 role 필드 하나만 추가하면 누구나 관리자가 되고 삭제 권한이 열린다.
// 역할은 입력이 아니라 이 창구의 상수여야 한다.
test("가입으로 만든 계정은 언제나 editor다", async () => {
  const email = uniqueEmail();

  const res = await register({ email, password: "hunter2hunter2", role: "admin" });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.role).toBe("editor");
});

test("이름을 비우면 이메일이 표시 이름이 된다", async () => {
  const email = uniqueEmail();

  const res = await register({ email, password: "hunter2hunter2" });

  const body = await res.json();
  expect(body.user.name).toBe(email);
});

test("이메일은 소문자로 저장된다", async () => {
  const email = uniqueEmail("Mixed").toUpperCase();

  const res = await register({ email, password: "hunter2hunter2" });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.email).toBe(email.toLowerCase());
});

test("이미 가입된 이메일은 409 email_taken이다", async () => {
  const email = uniqueEmail();
  await register({ email, password: "hunter2hunter2" });

  const res = await register({ email, password: "another-password" });

  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error.code).toBe("email_taken");
});

// R131의 핵심: 원문 유니크 인덱스만 있으면 이 요청이 통과해서 대소문자만 다른
// 계정이 둘 생기고, 로그인이 어느 쪽으로 들어갈지 행 순서에 달리게 된다.
test("대소문자만 다른 이메일도 같은 계정으로 본다", async () => {
  const email = uniqueEmail();
  await register({ email, password: "hunter2hunter2" });

  const res = await register({ email: email.toUpperCase(), password: "hunter2hunter2" });

  expect(res.status).toBe(409);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  expect(row!.n).toBe(1);
});

// 대문자로 가입해 놓고 다음 날 소문자로 치는 일은 흔하다. 원문 일치로만 찾으면
// 그 사람은 자기 계정을 못 찾고 "비밀번호가 틀렸다"는 말만 듣는다.
test("가입할 때와 대소문자가 달라도 로그인된다", async () => {
  const email = uniqueEmail("Case");
  await register({ email: email.toUpperCase(), password: "hunter2hunter2" });

  const res = await loginPost(
    postRequest("/api/v1/auth/login", { email: email.toLowerCase(), password: "hunter2hunter2" }),
  );

  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
});

test("8자 미만 비밀번호는 400이다", async () => {
  const res = await register({ email: uniqueEmail(), password: "short7" });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("validation_failed");
});

test("이메일 형식이 아니면 400이다", async () => {
  const res = await register({ email: "not-an-email", password: "hunter2hunter2" });

  expect(res.status).toBe(400);
});

test("본문이 없으면 400이다", async () => {
  const res = await register(undefined);

  expect(res.status).toBe(400);
});
