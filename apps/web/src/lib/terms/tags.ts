/** Keep tag spelling stable while removing empty and repeated values. */
export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((raw) => {
    const value = raw.normalize("NFC").trim().replace(/^#+/, "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}
