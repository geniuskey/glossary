import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { apiKeys } from "@grossary/db";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { hashApiKey, parseApiKey, type Scope } from "./api-key";

export type AuthResult =
  | { kind: "user"; user: CurrentUser }
  | { kind: "key"; keyId: string };

/**
 * R27: 저장된 해시와 요청 토큰의 해시를 비교한다. 문자열 `!==` 비교는 첫 불일치
 * 바이트에서 조기 반환해 타이밍으로 해시를 조금씩 흘릴 수 있어 timingSafeEqual을 쓴다.
 * timingSafeEqual은 길이가 다르면 예외를 던지므로, 길이 비교를 먼저 걸러야 한다 —
 * 이 길이 비교 자체는 비밀을 담고 있지 않다(둘 다 sha256 hex라 정상적으로는 항상
 * 64자다. 손상되었거나 조작된 값만 길이가 달라진다).
 */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function requireAuth(request: Request, scope: Scope): Promise<AuthResult | Response> {
  const header = request.headers.get("authorization");

  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const parsed = parseApiKey(token);
    if (!parsed) return apiError("unauthorized", "API 키 형식이 올바르지 않습니다.", 401);

    const [key] = await getDb()
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.prefix, parsed.prefix),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1);

    if (!key || !hashesMatch(key.keyHash, hashApiKey(token))) {
      return apiError("unauthorized", "API 키가 유효하지 않습니다.", 401);
    }
    if (!key.scopes.includes(scope)) {
      return apiError("forbidden", `이 키에는 ${scope} 권한이 없습니다.`, 403);
    }

    await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
    return { kind: "key", keyId: key.id };
  }

  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);
  return { kind: "user", user };
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
