const SECRET_KEYS = new Set([
  "access_token",
  "authorization",
  "client_secret",
  "code",
  "cookie",
  "id_token",
  "password",
  "refresh_token",
  "state",
  "nonce",
  "verifier",
]);

/** IdP 응답을 로그에 남길 때 토큰·코드·시크릿은 값 대신 존재 여부만 남긴다. */
export function sanitizeSsoValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limit]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeSsoValue(item, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 12).join("\n"),
      ...(value.cause !== undefined ? { cause: sanitizeSsoValue(value.cause, depth + 1) } : {}),
    };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? (item ? "[redacted]" : item) : sanitizeSsoValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function logSsoFailure(
  stage: string,
  context: Record<string, unknown>,
  error?: unknown,
): void {
  console.error("[Grossary SSO]", JSON.stringify({
    time: new Date().toISOString(),
    stage,
    ...sanitizeSsoValue(context) as Record<string, unknown>,
    ...(error === undefined ? {} : { error: sanitizeSsoValue(error) }),
  }));
}
