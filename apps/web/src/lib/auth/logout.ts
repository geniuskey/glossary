// F7/Q4(review §2 Q4, §3): app/login/page.tsx:18은 `if (res.ok)`로 분기해서
// 실패하면 이동하지 않는데, LogoutButton은 fetch 결과를 확인하지 않고 항상
// router.replace("/login")로 이동했다. `/api/v1/auth/logout`이 5xx를 돌려주면
// 세션 쿠키는 그대로 살아 있는데 화면만 로그인 화면으로 바뀐다 — 공유 PC에서
// 주소창에 `/terms`를 다시 치면 로그인된 채로 열린다. 로그인과 같은 패턴으로
// 맞춘다: 응답이 ok가 아니거나 fetch 자체가 reject하면 이동하지 않는다.
//
// R97과 같은 이유로 fetch/router를 인자로 받는 순수 함수로 뽑는다 —
// vitest.config.ts에는 jsdom이 없어 Client Component를 직접 렌더해 테스트할
// 수 없다(apps/web/tests/logout.test.ts에서 모킹한 fetch/router로 검증).
export interface LogoutRouter {
  replace(href: string): void;
  refresh(): void;
}

export async function performLogout(fetchImpl: typeof fetch, router: LogoutRouter): Promise<boolean> {
  let ok: boolean;
  try {
    const res = await fetchImpl("/api/v1/auth/logout", { method: "POST" });
    ok = res.ok;
  } catch {
    // 네트워크 오류로 reject한 경우도 실패로 취급한다 — 버튼이 조용히 아무
    // 일도 안 한 것처럼 보이더라도, unhandled rejection으로 끝나거나 세션이
    // 살아있는데 로그인 화면으로 이동하는 것보다는 낫다.
    ok = false;
  }
  if (!ok) return false;

  router.replace("/login");
  router.refresh();
  return true;
}
