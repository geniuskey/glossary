/** 환경변수 원문을 안전한 CSP frame-ancestors 값으로 좁힌다. */
export function embedFrameAncestors(raw = process.env.GROSSARY_EMBED_ANCESTORS): string {
  const allowed = new Set<string>(["'self'"]);
  for (const token of raw?.split(/[\s,]+/).filter(Boolean) ?? []) {
    try {
      const url = new URL(token);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        allowed.add(url.origin);
      }
    } catch {
      // 잘못된 값과 헤더 삽입 문자열은 무시한다.
    }
  }
  return [...allowed].join(" ");
}
