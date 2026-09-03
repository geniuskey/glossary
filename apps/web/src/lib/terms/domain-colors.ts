import type { CSSProperties } from "react";

export interface DomainColor {
  key: string;
  hue: number;
}

// 인접 도메인에 비슷한 색이 연달아 배정되지 않도록 황금각으로 색상환을 돈다.
// 테마별 밝기·채도는 CSS가 상태 색상처럼 옅게 조정하고, 72개 키는 DB에서
// 고유하게 유지한다.
export const DOMAIN_COLOR_PALETTE: readonly DomainColor[] = Array.from({ length: 72 }, (_, index) => {
  return {
    key: `p${String(index).padStart(2, "0")}`,
    hue: Math.round((index * 137.508) % 360),
  };
});

export const DOMAIN_COLOR_KEYS: ReadonlySet<string> = new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key));

export function domainColor(colorKey: string | null | undefined): DomainColor {
  return DOMAIN_COLOR_PALETTE.find((color) => color.key === colorKey) ?? DOMAIN_COLOR_PALETTE[0]!;
}

export function domainColorStyle(colorKey: string | null | undefined): CSSProperties {
  const color = domainColor(colorKey);
  return {
    "--graph-category-hue": color.hue,
  } as CSSProperties;
}

export function firstUnusedDomainColor(used: ReadonlySet<string>): string | null {
  return DOMAIN_COLOR_PALETTE.find((color) => !used.has(color.key))?.key ?? null;
}
