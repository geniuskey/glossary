"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { cx } from "@/lib/ui/format";

const STORAGE_KEY = "grossary.sidebar-collapsed";

export function CollapsibleSidebar({
  brand,
  navigation,
}: {
  brand: ReactNode;
  navigation: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    // 페이지 이동으로 셸이 다시 마운트될 때 저장된 접힘 상태는 첫 페인트 전에
    // 즉시 복원한다. transition은 그 다음 프레임부터 켜야, 이미 접힌 상태인데도
    // 매 화면마다 펼침 → 접힘 애니메이션이 재생되지 않는다.
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return (
    <aside
      data-sidebar-collapsed={collapsed}
      className={cx(
        "sticky top-0 z-30 shrink-0 border-b border-line bg-panel/85 backdrop-blur",
        "lg:h-screen lg:border-b-0 lg:border-r",
        ready && "lg:transition-[width] lg:duration-200",
        collapsed ? "lg:w-[4.5rem]" : "lg:w-60",
      )}
    >
      <div className="flex h-14 min-w-0 items-center gap-2 px-3 lg:h-full lg:flex-col lg:items-stretch lg:gap-0 lg:px-0 lg:py-5">
        <div className="sidebar-header flex shrink-0 items-center lg:w-full lg:px-2 lg:pb-5">
          {brand}
          <button
            type="button"
            onClick={toggle}
            aria-controls="primary-navigation"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            className="btn-quiet hidden h-8 w-8 shrink-0 p-0 lg:inline-flex"
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>
        {navigation}
      </div>
    </aside>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.75" y="2" width="12.5" height="12" rx="1.5" />
      <path d="M5.25 2v12" />
      <path d={collapsed ? "m8 5 3 3-3 3" : "m11 5-3 3 3 3"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
