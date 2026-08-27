"use client";

import { useRouter } from "next/navigation";

// R95(보안 불변식): 로그아웃은 상태를 바꾸는 동작이다. 이 사이트의 CSRF 방어는
// SameSite=Lax 쿠키 하나뿐이라, `<Link href="/api/v1/auth/logout">` 같은 GET
// 요청으로 만들면 그 방어가 즉시 무력화된다. `/api/v1/auth/logout`은 이미
// POST로 구현돼 있으므로(session 쿠키를 지운다), 여기서는 그 POST를 fetch로
// 부른 뒤 로그인 화면으로 이동한다. AppShell 전체를 Client Component로 만들면
// 헤더 전부가 클라이언트 번들에 들어가므로, 상태를 갖는 이 조각만 분리한다.
export function LogoutButton() {
  const router = useRouter();

  async function onClick() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={onClick} className="text-slate-600 hover:text-slate-900">
      로그아웃
    </button>
  );
}
