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
// scrypt의 실제 메모리 요구량은 OpenSSL 기준 128*r*(N+p+2)바이트다(아래 근사식
// 128*N*r*p는 이를 단순화한 상한 추정치일 뿐 정확한 공식이 아니다 — MAX_COST_PRODUCT
// 주석 참고). N=2^15, r=8, p=1이면 128*8*(32768+1+2)=33,557,504바이트로 Node 기본
// maxmem(32MB=33,554,432바이트)을 미세하게 넘어 예외가 난다(실측 확인). maxmem을
// 명시적으로 올려야 한다.
//
// 경고(R30): DUMMY_PASSWORD_HASH는 이 SCRYPT_N을 그대로 박아 넣는다. 나중에 이
// 상수만 올리고 기존 계정들의 저장된 해시(옛 N)를 재해시하지 않으면, "계정 없음"
// 경로(DUMMY_PASSWORD_HASH 검증)만 새 N을 쓰고 "계정 있음, 비밀번호 틀림" 경로는
// 여전히 옛 N을 써서 서로 다른 시간이 걸린다 — 로그인 라우트가 막으려던 타이밍
// 오라클이 반대 방향으로 재개방된다. 이 상수를 올릴 때는 기존 해시 마이그레이션을
// 함께 계획해야 한다.
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// N이 커도 저장값에서 파싱한 N/r/p가 SCRYPT_MAXMEM을 과도하게 넘는 메모리를
// 요구하지 못하게 막는 상한. 정확한 scrypt 공식 128*r*(N+p+2) 대신 곱셈으로
// 접은 128*N*r*p를 쓰기 때문에 형태가 어긋난다 — p=1 경계에서 실제보다 느슨하다
// (예: N=65536, r=8은 이 곱셈 가드를 통과하지만 실제로는 SCRYPT_MAXMEM을 넘어
// scrypt() 호출 자체가 던지고, 아래 try/catch가 그 예외를 받아 false로 처리한다).
// 즉 가드가 느슨해도 결과는 안전하므로 동작은 바꾸지 않는다.
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
