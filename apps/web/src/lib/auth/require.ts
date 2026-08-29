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

// R36: RFC 7235에 따라 인증 스킴 토큰("Bearer")은 대소문자를 구분하지 않는다.
// startsWith("Bearer ")는 "bearer <key>"를 세션 경로로 흘려보내 잘못되고 오해의
// 소지가 있는 "로그인이 필요합니다"를 반환한다. 스킴만 대소문자 무시로 매칭하고,
// 토큰 자체는 원래 대소문자 그대로 유지한다(base64url은 대소문자를 구분한다).
const BEARER_SCHEME = /^bearer\s+/i;

export async function requireAuth(request: Request, scope: Scope): Promise<AuthResult | Response> {
  const header = request.headers.get("authorization");
  const bearerMatch = header ? BEARER_SCHEME.exec(header) : null;

  if (bearerMatch) {
    const token = header!.slice(bearerMatch[0].length).trim();
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

/**
 * R132: 사람(세션) + 관리자만 통과시킨다. requireAuth와 달리 API 키 경로가 없다 —
 * SSO 설정 창구는 IdP 클라이언트 시크릿을 다루므로, 어딘가에 적혀 돌아다닐 수 있는
 * 키가 아니라 그 자리에 로그인한 사람만 열 수 있어야 한다.
 */
export async function requireAdminUser(): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);
  if (user.role !== "admin") return apiError("forbidden", "관리자만 사용할 수 있습니다.", 403);
  return user;
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
