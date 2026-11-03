import "server-only";

import { sql } from "drizzle-orm";
import { rateLimitBuckets } from "@glossary/db";
import { getDb } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * A small fixed-window limiter stored in PostgreSQL so multiple web
 * instances share the same budget. The upsert is atomic for a given key.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date();
  const boundary = new Date(now.getTime() - windowMs);
  const nowIso = now.toISOString();
  const boundaryIso = boundary.toISOString();
  const [row] = await getDb()
    .insert(rateLimitBuckets)
    .values({ key, windowStart: now, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        windowStart: sql`case when ${rateLimitBuckets.windowStart} <= ${boundaryIso}::timestamptz then ${nowIso}::timestamptz else ${rateLimitBuckets.windowStart} end`,
        count: sql`case when ${rateLimitBuckets.windowStart} <= ${boundaryIso}::timestamptz then 1 else ${rateLimitBuckets.count} + 1 end`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimitBuckets.count, windowStart: rateLimitBuckets.windowStart });

  if (!row) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  const expiresAt = row.windowStart.getTime() + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000));
  return {
    allowed: row.count <= limit,
    retryAfterSeconds: row.count <= limit ? 0 : retryAfterSeconds,
  };
}

export function rateLimitResponse(result: RateLimitResult, message: string): Response | null {
  if (result.allowed) return null;
  const response = Response.json({ error: { code: "rate_limited", message } }, { status: 429 });
  response.headers.set("retry-after", String(result.retryAfterSeconds));
  return response;
}

/** 프록시 헤더를 믿지 않거나 헤더가 없어서 요청자를 구분할 수 없을 때의 값이다. */
export const UNKNOWN_CLIENT_ADDRESS = "direct";

export function clientAddress(request: Request): string {
  if (process.env.GLOSSARY_TRUST_PROXY_HEADERS === "true") {
    // Cloudflare appends to a client-supplied X-Forwarded-For value. Its
    // single-address CF-Connecting-IP header is the reliable visitor address.
    const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
    if (cloudflare) return cloudflare;

    // nginx의 X-Real-IP는 프록시가 직접 본 주소 하나로 덮어쓴다. X-Forwarded-For는
    // 클라이언트가 보낸 값 뒤에 덧붙이므로 첫 값은 위조할 수 있고, 마지막 값만 우리 프록시가 쓴 것이다.
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return UNKNOWN_CLIENT_ADDRESS;
}

/**
 * 주소별 버킷을 쓴다. 주소를 모르면 모든 요청이 "direct" 버킷 하나를 나눠 쓰게 되어,
 * 누구든 한도만큼 요청을 보내 전체 로그인·가입을 잠글 수 있다 — 그때는 주소 한도를 건너뛰고
 * 호출부의 이메일별 한도에 맡긴다.
 */
export async function consumeAddressRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const address = clientAddress(request);
  if (address === UNKNOWN_CLIENT_ADDRESS) return { allowed: true, retryAfterSeconds: 0 };
  return consumeRateLimit(`${scope}:address:${address}`, limit, windowMs);
}
