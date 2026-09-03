import { expect, test } from "vitest";
import { DOMAIN_COLOR_PALETTE, firstUnusedDomainColor } from "../src/lib/terms/domain-colors.js";

test("도메인 팔레트는 옅은 계열 72개를 고유 키로 제공한다", () => {
  expect(DOMAIN_COLOR_PALETTE).toHaveLength(72);
  expect(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key)).size).toBe(72);
  expect(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.hue)).size).toBe(72);
});

test("새 도메인은 아직 사용하지 않은 색상만 배정받는다", () => {
  const used = new Set(DOMAIN_COLOR_PALETTE.slice(0, 3).map((color) => color.key));
  expect(firstUnusedDomainColor(used)).toBe(DOMAIN_COLOR_PALETTE[3]!.key);
  expect(firstUnusedDomainColor(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key)))).toBeNull();
});
