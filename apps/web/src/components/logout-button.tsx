"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { performLogout } from "@/lib/auth/logout";

// R95(보안 불변식): 로그아웃은 상태를 바꾸는 동작이다. 이 사이트의 CSRF 방어는
// SameSite=Lax 쿠키 하나뿐이라, `<Link href="/api/v1/auth/logout">` 같은 GET
// 요청으로 만들면 그 방어가 즉시 무력화된다. `/api/v1/auth/logout`은 이미
// POST로 구현돼 있으므로(session 쿠키를 지운다), performLogout(lib/auth/logout.ts)이
// 그 POST를 fetch로 부르고 응답을 확인한 뒤에만 로그인 화면으로 이동한다
// (F7 — 응답을 확인하지 않으면 5xx에서도 로그인 화면으로 넘어가면서 세션
// 쿠키가 살아있는 채로 남는다). AppShell 전체를 Client Component로 만들면
// 헤더 전부가 클라이언트 번들에 들어가므로, 상태를 갖는 이 조각만 분리한다.
export function LogoutButton({
  alwaysShowLabel = false,
  menuItem = false,
}: {
  alwaysShowLabel?: boolean;
  menuItem?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await performLogout(fetch, router);
    if (!ok) {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      role={menuItem ? "menuitem" : undefined}
      onClick={onClick}
      disabled={busy}
      title={failed ? "로그아웃하지 못했습니다. 다시 시도하세요." : "로그아웃"}
      aria-label={failed ? "로그아웃 실패, 다시 시도" : "로그아웃"}
      className={alwaysShowLabel ? "btn-quiet btn-sm w-full justify-start" : "btn-quiet btn-sm"}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" strokeLinecap="round" />
        <path d="M10.5 11 14 8l-3.5-3M14 8H6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={alwaysShowLabel ? undefined : "sidebar-expanded-only hidden lg:inline"}>{busy ? "로그아웃 중" : failed ? "다시 시도" : "로그아웃"}</span>
    </button>
  );
}
