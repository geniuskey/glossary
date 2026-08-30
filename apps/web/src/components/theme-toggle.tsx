"use client";

import { useLayoutEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "grossary.theme";

const LABEL: Record<Theme, string> = { system: "시스템", light: "밝게", dark: "어둡게" };
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

/**
 * 테마 상태는 셋이다(시스템/밝게/어둡게). html의 data-theme 속성 하나로만
 * 표현하고(globals.css가 그 세 경우를 전부 정의한다), 첫 페인트 전에 적용하는
 * 일은 layout.tsx의 인라인 스크립트가 맡는다 — 여기서 하면 이미 늦어서
 * 흰 화면이 한 프레임 번쩍인다.
 */
export function ThemeToggle({
  alwaysShowLabel = false,
  menuItem = false,
}: {
  alwaysShowLabel?: boolean;
  menuItem?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>("system");

  // 저장된 값을 다시 읽어 (1) 버튼 라벨을 맞추고 (2) data-theme을 다시 건다.
  // (2)가 필요한 이유: 개발 모드의 StrictMode 재마운트에서 React가 <html>의
  // 속성을 JSX가 관리하는 것만 남기고 지워버려, layout.tsx의 인라인 스크립트가
  // 걸어둔 data-theme이 사라진다(운영 빌드에서는 no-op).
  useLayoutEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem(STORAGE_KEY);
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE_KEY, next);
    }
  }

  return (
    <button
      type="button"
      role={menuItem ? "menuitem" : undefined}
      onClick={() => apply(NEXT[theme])}
      title={`테마: ${LABEL[theme]}`}
      aria-label={`테마 전환 (현재 ${LABEL[theme]})`}
      className="btn-quiet btn-sm"
    >
      <ThemeIcon theme={theme} />
      <span className={alwaysShowLabel ? undefined : "sidebar-expanded-only hidden lg:inline"}>{LABEL[theme]}</span>
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  if (theme === "dark") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
      </svg>
    );
  }
  if (theme === "light") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="3" width="13" height="8.5" rx="1.4" />
      <path d="M5.5 14h5" strokeLinecap="round" />
    </svg>
  );
}
