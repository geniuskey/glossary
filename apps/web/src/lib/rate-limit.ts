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

export function clientAddress(request: Request): string {
  if (process.env.GLOSSARY_TRUST_PROXY_HEADERS === "true") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
    const real = request.headers.get("x-real-ip")?.trim();
    if (forwarded || real) return forwarded || real!;
  }
  return "direct";
}
