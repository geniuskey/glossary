import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { sessions } from "@grossary/db";
import { getDb } from "@/lib/db";

export const SESSION_COOKIE = "grossary_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * 쿠키에 담는 토큰 원문과 DB에 남는 값을 분리한다.
 * 백업 파일이나 덤프 한 벌이 그대로 살아있는 세션 묶음이 되지 않게 하려는 것이다.
 * 토큰이 이미 256비트 난수라 솔트나 느린 해시가 필요 없다. 조회 때마다 도는 경로다.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await getDb().insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  await getDb().delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}

export async function purgeExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
