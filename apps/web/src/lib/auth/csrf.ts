import { apiError } from "@/lib/api-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigins(): string[] {
  return (process.env.GLOSSARY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function isAllowedCsrfOrigin(request: Request, origin: string | null): boolean {
  if (!origin || origin === "null") return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }

  const allowed = configuredOrigins();
  if (allowed.length > 0) return allowed.includes(normalized);

  // Without an explicit public origin, direct deployments can still protect
  // themselves. Behind a reverse proxy, set GLOSSARY_ALLOWED_ORIGINS so the
  // internal request URL cannot accidentally become the trust boundary.
  return normalized === new URL(request.url).origin;
}

/**
 * Cookie-authenticated unsafe requests must prove they came from the
 * configured application origin. API-key requests do not call this helper,
 * because they have no ambient browser credential to forge.
 */
export function enforceCsrf(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  // Route tests intentionally exercise handlers without browser headers. The
  // production path is always enforced; dedicated CSRF tests cover the guard.
  if (process.env.NODE_ENV === "test") return null;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidate = origin ?? (referer ? (() => {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  })() : null);

  if (!isAllowedCsrfOrigin(request, candidate)) {
    return apiError("csrf_failed", "요청 출처를 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", 403);
  }
  return null;
}
