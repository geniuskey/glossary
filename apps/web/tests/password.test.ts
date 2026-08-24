import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.js";

test("올바른 비밀번호를 검증한다", async () => {
  const stored = await hashPassword("correct horse battery");
  await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
});

test("틀린 비밀번호를 거부한다", async () => {
  const stored = await hashPassword("correct horse battery");
  await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
});

test("같은 비밀번호도 매번 다른 해시를 만든다", async () => {
  const a = await hashPassword("same");
  const b = await hashPassword("same");
  expect(a).not.toBe(b);
});

test("손상된 저장값에서 예외 대신 false를 반환한다", async () => {
  await expect(verifyPassword("x", "garbage")).resolves.toBe(false);
});
