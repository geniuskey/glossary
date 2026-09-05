import { expect, test } from "vitest";
import { DOMAIN_COLOR_PALETTE, DOMAIN_COLOR_SETS, domainColorStyle, firstUnusedDomainColor } from "../src/lib/terms/domain-colors.js";

test("도메인 팔레트는 파스텔 16색과 선명한 확장 8색만 제공한다", () => {
  expect(DOMAIN_COLOR_PALETTE).toHaveLength(24);
  expect(DOMAIN_COLOR_SETS.map((set) => set.key)).toEqual(["pastel", "clear"]);
  expect(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key)).size).toBe(24);
  expect(DOMAIN_COLOR_PALETTE.filter((color) => color.set === "pastel")).toHaveLength(16);
  expect(DOMAIN_COLOR_PALETTE.filter((color) => color.set === "clear")).toHaveLength(8);
  expect(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.hue)).size).toBe(24);
  expect(domainColorStyle("p23")).toMatchObject({ "--domain-color-saturation-boost": "22%" });
});

test("기존 72색 팔레트의 저장값은 선택지에서 빠져도 같은 색으로 렌더링한다", () => {
  expect(DOMAIN_COLOR_PALETTE.some((color) => color.key === "p71")).toBe(false);
  expect(domainColorStyle("p71")).toMatchObject({
    "--graph-category-hue": 247,
    "--domain-color-saturation-boost": "36%",
  });
});

test("새 도메인은 아직 사용하지 않은 색상만 배정받는다", () => {
  const used = new Set(DOMAIN_COLOR_PALETTE.slice(0, 3).map((color) => color.key));
  expect(firstUnusedDomainColor(used)).toBe(DOMAIN_COLOR_PALETTE[3]!.key);
  expect(firstUnusedDomainColor(new Set(DOMAIN_COLOR_PALETTE.map((color) => color.key)))).toBeNull();
});
