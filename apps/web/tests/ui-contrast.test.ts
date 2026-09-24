import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { workspaceBrandPresets } from "@glossary/db";
import { WORKSPACE_BRAND_OPTIONS } from "../src/lib/workspace/menu-settings-values.js";

const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
type Tokens = Record<string, number[]>;
const blocks = new Map<string, Tokens>();
// 줄 머리의 선택자만 본다 — 주석 속 ":root"까지 선택자로 잡히면 블록 이름이 틀어진다.
for (const match of styles.matchAll(/^[ \t]*(:root[^{}\n]*?)\s*\{([^}]+)\}/gm)) {
  const tokens: Tokens = Object.fromEntries([...match[2]!.matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+);/g)]
    .map((token) => [token[1]!, token.slice(2).map(Number)]));
  if (Object.keys(tokens).length > 0) blocks.set(match[1]!.trim(), tokens);
}

const SYSTEM_DARK = ':not([data-theme="light"])';
const EXPLICIT_DARK = '[data-theme="dark"]';
const customPresets = workspaceBrandPresets.filter((preset) => preset !== "navy");

function block(selector: string): Tokens {
  const tokens = blocks.get(selector);
  expect(tokens, selector).toBeDefined();
  return tokens!;
}

function themes() {
  const light = block(":root");
  const dark = { ...light, ...block(`:root${EXPLICIT_DARK}`) };
  return [
    { name: "navy/light", tokens: light },
    { name: "navy/dark", tokens: dark },
    ...customPresets.flatMap((preset) => [
      { name: `${preset}/light`, tokens: { ...light, ...block(`:root[data-brand="${preset}"]`) } },
      { name: `${preset}/dark`, tokens: { ...dark, ...block(`:root[data-brand="${preset}"]${EXPLICIT_DARK}`) } },
    ]),
  ];
}

function luminance(rgb: number[]) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

test("작은 보조 문구와 상태 배지는 모든 대표 색·테마에서 4.5:1 이상의 대비를 유지한다", () => {
  const pairs = [
    ...["paper", "panel", "panel-2"].flatMap((background) =>
      ["ink", "ink-2", "ink-3"].map((foreground) => [foreground, background])),
    ...["brand", "ok", "warn", "danger", "info", "accent"].map((color) => [color, `${color}-soft`]),
    ["brand-on", "brand"],
    ["brand-on", "brand-2"],
    ["accent", "panel"],
    // 사이드바는 의미 토큰을 대표 색 면 값으로 다시 매핑한다(.sidebar-surface).
    ...["sidebar-ink", "sidebar-ink-2", "sidebar-ink-3"].map((foreground) => [foreground, "sidebar"]),
    ["sidebar-ink", "sidebar-hover"],
    ["sidebar-ink-2", "sidebar-hover"],
    ["sidebar-brand", "sidebar-active"],
  ];
  for (const { name, tokens } of themes()) {
    for (const [foreground, background] of pairs) {
      const a = luminance(tokens[foreground!]!);
      const b = luminance(tokens[background!]!);
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(contrast, `${name}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("시스템 다크와 명시 다크 블록은 같은 값을 가진다", () => {
  expect(block(`:root${SYSTEM_DARK}`)).toEqual(block(`:root${EXPLICIT_DARK}`));
  for (const preset of customPresets) {
    expect(block(`:root[data-brand="${preset}"]${SYSTEM_DARK}`), preset)
      .toEqual(block(`:root[data-brand="${preset}"]${EXPLICIT_DARK}`));
  }
});

test("DB 프리셋 목록, 관리자 선택지, CSS 블록이 서로 어긋나지 않는다", () => {
  expect(WORKSPACE_BRAND_OPTIONS.map((option) => option.key)).toEqual([...workspaceBrandPresets]);
  const cssPresets = [...blocks.keys()]
    .map((selector) => /^:root\[data-brand="([\w-]+)"\]$/.exec(selector)?.[1])
    .filter((preset): preset is string => Boolean(preset));
  expect(cssPresets).toEqual(customPresets);
  // 관리자 클라이언트 컴포넌트가 읽는 파일이라 DB 패키지 값을 가져오면 postgres가 번들에 실린다.
  const valuesSource = readFileSync(new URL("../src/lib/workspace/menu-settings-values.ts", import.meta.url), "utf8");
  expect(valuesSource).not.toMatch(/^import \{[^}]*\} from "@glossary\/db"/m);
});
