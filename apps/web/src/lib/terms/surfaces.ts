import { surfaceKeys } from "@grossary/db";
import type { SurfaceInput } from "./schema";

/** 표준 표기 필드만 추린 공통 형태. TermInput과 terms 테이블 row 양쪽이 만족한다. */
export interface CanonicalNames {
  termType: string;
  nameEn?: string | null;
  nameKo?: string | null;
  fullNameEn?: string | null;
  fullNameKo?: string | null;
}

/** 짧은 전대문자 표기는 대소문자를 구분해야 노이즈가 생기지 않는다. */
export function defaultCaseSensitive(text: string): boolean {
  return /^[A-Z0-9]{2,6}$/.test(text);
}

/**
 * 표준 표기에서 파생된 표기와 사용자가 직접 넣은 표기를 합친다.
 * 정규화 키와 kind가 같으면 먼저 온 쪽을 남긴다.
 */
export function deriveSurfaces(names: CanonicalNames, explicit: SurfaceInput[]): SurfaceInput[] {
  const derived: SurfaceInput[] = [];
  const isAbbrev = names.termType === "abbreviation";

  if (names.nameEn) {
    derived.push({ text: names.nameEn, lang: "en", kind: isAbbrev ? "abbreviation" : "canonical" });
  }
  if (names.nameKo) derived.push({ text: names.nameKo, lang: "ko", kind: "canonical" });
  if (names.fullNameEn) derived.push({ text: names.fullNameEn, lang: "en", kind: "full_name" });
  if (names.fullNameKo) derived.push({ text: names.fullNameKo, lang: "ko", kind: "full_name" });

  const seen = new Set<string>();
  return [...derived, ...explicit].filter((s) => {
    const key = `${surfaceKeys(s.text).normLoose}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
