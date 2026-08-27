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

// 아래는 F3(리뷰) 대응: 저장 형식에 scrypt 비용 파라미터(N/r/p)를 함께 기록해서
// 나중에 비용을 올려도 기존 해시를 구분/검증할 수 있게 한 것을 검증한다.

test("저장 형식에 scrypt 비용 파라미터가 기록된다", async () => {
  const stored = await hashPassword("cost params");
  const parts = stored.split("$");
  expect(parts).toHaveLength(6);
  const [scheme, N, r, p] = parts;
  expect(scheme).toBe("scrypt");
  expect(N).toBe("32768");
  expect(r).toBe("8");
  expect(p).toBe("1");
});

test.each([
  ["N이 숫자가 아님", "scrypt$notanumber$8$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["N이 2의 거듭제곱이 아님", "scrypt$32769$8$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["N이 0", "scrypt$0$8$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["N이 음수", "scrypt$-32768$8$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["r이 0", "scrypt$32768$0$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["p가 소수점", "scrypt$32768$8$1.5$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["N이 메모리 상한을 초과", "scrypt$1048576$8$1$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
  ["파라미터 구간이 통째로 빠짐", "scrypt$00112233445566778899aabbccddeeff$" + "00".repeat(64)],
])("깨진 비용 파라미터(%s)는 예외 대신 false를 반환한다", async (_label, stored) => {
  await expect(verifyPassword("x", stored)).resolves.toBe(false);
});
