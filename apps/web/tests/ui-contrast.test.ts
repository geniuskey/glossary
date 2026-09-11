import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const themes = [...styles.matchAll(/:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?\s*\{([^}]+)\}/g)]
  .map((match) => Object.fromEntries([...match[1]!.matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+);/g)]
    .map((token) => [token[1]!, token.slice(2).map(Number)])))
  .filter((tokens) => tokens["paper"]);

function luminance(rgb: number[]) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

test("작은 보조 문구와 상태 배지는 밝은·어두운 테마에서 4.5:1 이상의 대비를 유지한다", () => {
  expect(themes).toHaveLength(3);
  const pairs = [
    ...["paper", "panel", "panel-2"].flatMap((background) =>
      ["ink", "ink-2", "ink-3"].map((foreground) => [foreground, background])),
    ...["brand", "ok", "warn", "danger", "info"].map((color) => [color, `${color}-soft`]),
    ["brand-on", "brand"],
    ["brand-on", "brand-2"],
  ];
  for (const [index, tokens] of themes.entries()) {
    for (const [foreground, background] of pairs) {
      const a = luminance(tokens[foreground!]!);
      const b = luminance(tokens[background!]!);
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(contrast, `theme ${index}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
