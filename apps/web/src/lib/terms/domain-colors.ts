import type { CSSProperties } from "react";

export interface DomainColor {
  key: string;
  hue: number;
  set: DomainColorSetKey;
  saturationBoost: number;
  lightnessDrop: number;
}

export type DomainColorSetKey = "pastel" | "clear";

export interface DomainColorSet {
  key: DomainColorSetKey;
  label: string;
  count: number;
  saturationBoost: number;
  lightnessDrop: number;
}

// 실제 선택지는 한눈에 비교할 수 있는 24개로 제한한다. 앞의 16개는 기본
// 파스텔, 뒤의 8개는 조금 더 또렷한 확장색이다. 황금각 순서로 배치해 새
// 도메인에 연달아 자동 배정해도 이웃한 색상 계열이 충분히 떨어진다.
export const DOMAIN_COLOR_SETS: readonly DomainColorSet[] = [
  { key: "pastel", label: "파스텔", count: 16, saturationBoost: 0, lightnessDrop: 0 },
  { key: "clear", label: "선명", count: 8, saturationBoost: 22, lightnessDrop: 4 },
];

export const DOMAIN_COLOR_PALETTE: readonly DomainColor[] = DOMAIN_COLOR_SETS.flatMap((set, setIndex, sets) => {
  const offset = sets.slice(0, setIndex).reduce((total, item) => total + item.count, 0);
  return Array.from({ length: set.count }, (_, colorIndex) => {
    const paletteIndex = offset + colorIndex;
    return {
      key: `p${String(paletteIndex).padStart(2, "0")}`,
      hue: Math.round((paletteIndex * 137.508) % 360),
      set: set.key,
      saturationBoost: set.saturationBoost,
      lightnessDrop: set.lightnessDrop,
    };
  });
});

export const DOMAIN_COLOR_KEYS: ReadonlySet<string> = new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key));

export function domainColor(colorKey: string | null | undefined): DomainColor {
  const visible = DOMAIN_COLOR_PALETTE.find((color) => color.key === colorKey);
  if (visible) return visible;

  // 0.1.6 초기 팔레트에서 저장한 p24~p71은 선택 목록에서는 제거하되 기존
  // 도메인의 화면 색은 바뀌지 않게 종전 계산식으로 계속 렌더링한다.
  const match = /^p(\d{2})$/.exec(colorKey ?? "");
  const legacyIndex = match ? Number(match[1]) : -1;
  if (legacyIndex >= 24 && legacyIndex < 72) {
    const legacySet = Math.floor(legacyIndex / 18);
    const colorIndex = legacyIndex % 18;
    const saturationBoost = [0, 12, 24, 36][legacySet] ?? 0;
    const lightnessDrop = [0, 2, 4, 6][legacySet] ?? 0;
    return {
      key: colorKey!,
      hue: Math.round((colorIndex * 137.508 + legacySet * 23) % 360),
      set: legacySet === 0 ? "pastel" : "clear",
      saturationBoost,
      lightnessDrop,
    };
  }
  return DOMAIN_COLOR_PALETTE[0]!;
}

export function domainColorStyle(colorKey: string | null | undefined): CSSProperties {
  const color = domainColor(colorKey);
  return {
    "--graph-category-hue": color.hue,
    "--domain-color-saturation-boost": `${color.saturationBoost}%`,
    "--domain-color-lightness-drop": `${color.lightnessDrop}%`,
  } as CSSProperties;
}

export function firstUnusedDomainColor(used: ReadonlySet<string>): string | null {
  return DOMAIN_COLOR_PALETTE.find((color) => !used.has(color.key))?.key ?? null;
}
