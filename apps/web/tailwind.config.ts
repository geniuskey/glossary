import type { Config } from "tailwindcss";

// 색은 globals.css의 CSS 변수 하나에서만 나온다. 여기서는 그 변수를 의미 이름에
// 매핑만 한다 — 화면 코드에 slate-300 같은 팔레트 값이 직접 박히면 테마 전환이
// 구조적으로 불가능해지기 때문이다(alpha 채널을 쓰려고 `<alpha-value>` 형식으로 둔다).
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        panel: { DEFAULT: token("panel"), 2: token("panel-2") },
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        ink: { DEFAULT: token("ink"), 2: token("ink-2"), 3: token("ink-3") },
        brand: {
          DEFAULT: token("brand"),
          2: token("brand-2"),
          soft: token("brand-soft"),
          on: token("brand-on"),
        },
        ok: { DEFAULT: token("ok"), soft: token("ok-soft") },
        warn: { DEFAULT: token("warn"), soft: token("warn-soft") },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
        grid: token("grid-line"),
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Mono", "Consolas", "D2Coding", "monospace"],
      },
      boxShadow: {
        pop: "0 12px 32px -12px rgb(0 0 0 / 0.28), 0 2px 6px -2px rgb(0 0 0 / 0.12)",
        cell: "inset 0 0 0 2px rgb(var(--selection))",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: { "fade-up": "fade-up 140ms ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
