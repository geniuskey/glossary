import { surfaceKeys } from "@glossary/db";
import type { SurfaceInput } from "./schema";
import { inferSurfaceLang } from "./surface-language";

/** 표준 표기 필드만 추린 공통 형태. TermInput과 terms 테이블 row 양쪽이 만족한다. */
export interface CanonicalNames {
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
  const normalizedExplicit = explicit.map((surface) => ({ ...surface, lang: inferSurfaceLang(surface.text) }));
  // 대표 영문 표기와 같은 약어를 명시해 둔
  // 기존 데이터는 그 kind를 우선해, 다시 저장해도 canonical로 뒤집히지 않는다.
  const nameEnKey = names.nameEn ? surfaceKeys(names.nameEn).normLoose : "";
  const nameEnKind = normalizedExplicit.some((surface) =>
    surface.kind === "abbreviation" && surfaceKeys(surface.text).normLoose === nameEnKey)
    ? "abbreviation"
    : "canonical";

  if (names.nameEn) {
    derived.push({ text: names.nameEn, lang: "en", kind: nameEnKind });
  }
  if (names.nameKo) derived.push({ text: names.nameKo, lang: "ko", kind: "canonical" });
  if (names.fullNameEn) derived.push({ text: names.fullNameEn, lang: "en", kind: "full_name" });
  if (names.fullNameKo) derived.push({ text: names.fullNameKo, lang: "ko", kind: "full_name" });

  const seen = new Set<string>();
  return [...derived, ...normalizedExplicit].filter((s) => {
    const key = `${surfaceKeys(s.text).normLoose}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface StoredSurface {
  text: string;
  kind: string;
}

/**
 * R110: 저장된 표기 중 "표준 이름에서 파생 가능한 것"을 뺀 나머지 — 즉 사용자가
 * 직접 추가한 명시 표기만 골라낸다. update.ts의 updateTerm(R51: "surfaces가
 * 없으면 기존 명시 표기를 유지한다")과 편집 폼(Task 13: 편집 화면 초기값에는
 * 파생 표기를 다시 보여주면 안 된다 — 표준 이름 필드가 이미 보여주므로)이 각자
 * 따로 이 판정을 하면 두 판정이 갈라질 수 있다(한쪽만 고치면 다른 쪽은 그대로
 * 남는다) — 한 함수로 소유권을 합쳐서 항상 같은 결과를 보장한다.
 */
export function pickExplicitSurfaces<T extends StoredSurface>(
  names: CanonicalNames,
  stored: readonly T[],
): T[] {
  const derived = deriveSurfaces(names, []);
  const derivedKeys = new Set(derived.map((s) => `${surfaceKeys(s.text).normLoose}:${s.kind}`));
  return stored.filter((r) => !derivedKeys.has(`${surfaceKeys(r.text).normLoose}:${r.kind}`));
}
