/** Drizzle 0.44+ wraps driver errors in DrizzleQueryError.cause. */
export function isUniqueViolation(error: unknown, constraints: readonly string[]): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const candidate = error as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === "23505" && typeof candidate.constraint_name === "string" && constraints.includes(candidate.constraint_name)) return true;
    error = candidate.cause;
  }
  return false;
}
