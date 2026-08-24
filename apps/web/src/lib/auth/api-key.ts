import { createHash, randomBytes } from "node:crypto";

export type Scope = "read" | "write" | "validate";

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `glk_${prefix}_${secret}`;
  return { token, prefix, hash: hashApiKey(token) };
}

// prefix는 randomBytes(4).toString("hex")라 [0-9a-f]{8} 고정폭이지만, secret은
// base64url이라 "_"를 포함할 수 있다(약 64자 중 1/64 확률 * 43자 ≈ 50%). 브리프 원안의
// token.split("_")는 이 경우 4개 이상의 조각으로 쪼개져 유효한 토큰을 계속 거부한다
// (실측: requireAuth 통합 테스트에서 재현). prefix의 고정 길이에 앵커링해 이를 피한다.
export function parseApiKey(token: string): { prefix: string } | null {
  const match = /^glk_([0-9a-f]{8})_(.+)$/.exec(token);
  if (!match) return null;
  return { prefix: match[1]! };
}
