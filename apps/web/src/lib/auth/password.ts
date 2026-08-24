import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, options: ScryptOptions,
) => Promise<Buffer>;

const KEY_LEN = 64;

// 저장 형식 scrypt$N$r$p$salt$hash에 실제로 쓰이는 현재 비용 파라미터.
// N=2^15는 128*N*r=32MB로 Node 기본 maxmem(32MB)과 정확히 같아서 예외가 난다(실측 확인).
// maxmem을 명시적으로 올려야 한다.
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// N이 커도 128*N*r*p가 SCRYPT_MAXMEM을 넘지 않도록 하는 상한. 저장값에서 파싱한
// N/r/p로 검증할 때, 손상되거나 악의적인 값이 과도한 메모리 요청으로 이어지지 않게 막는다.
const MAX_COST_PRODUCT = SCRYPT_MAXMEM / 128;

/**
 * 로그인 라우트가 "계정 없음"과 "계정 있음, 비밀번호 틀림"의 응답 시간을 맞추기 위해
 * scrypt 전체 경로를 타는 고정 더미 해시. 형식이 실제 저장 형식과 일치해야
 * verifyPassword가 scheme 검사에서 조기 반환하지 않고 scrypt를 완주한다.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(16)}$${"00".repeat(KEY_LEN)}`;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [scheme, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  if (scheme !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltHex || !hashHex) return false;

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;
  if (N < 2 || r < 1 || p < 1) return false;
  // 비트 연산(다음 줄)은 32비트로 좁혀 계산되므로, 그보다 먼저 안전한 범위로 제한해야 한다.
  // 이 순서를 바꾸면 N이 커도 오탐(거짓으로 2의 거듭제곱 판정)이 날 수 있다.
  if (N * r * p > MAX_COST_PRODUCT) return false; // 손상값이 과도한 메모리를 요구하지 못하게 막는다
  if ((N & (N - 1)) !== 0) return false; // N은 2의 거듭제곱이어야 한다

  try {
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== KEY_LEN) return false;
    const derived = await scryptAsync(plain, Buffer.from(saltHex, "hex"), KEY_LEN, { N, r, p, maxmem: SCRYPT_MAXMEM });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
