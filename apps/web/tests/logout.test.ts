import { expect, test, vi } from "vitest";
import { performLogout, type LogoutRouter } from "../src/lib/auth/logout.js";

function mockRouter(): LogoutRouter & { replace: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> } {
  return { replace: vi.fn(), refresh: vi.fn() };
}

// F7/Q4: app/login/page.tsx:18과 같은 패턴 — 응답이 ok일 때만 이동한다.
test("F7: 로그아웃 응답이 ok면 로그인 화면으로 이동하고 true를 반환한다", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
  const router = mockRouter();

  const result = await performLogout(fetchMock as unknown as typeof fetch, router);

  expect(result).toBe(true);
  expect(router.replace).toHaveBeenCalledWith("/login");
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

// F7 핵심 회귀: 5xx에서 fetch 결과를 확인하지 않고 이동하면, 세션 쿠키가
// 살아있는 채로 화면만 로그인 화면이 된다(공유 PC에서 위험).
test("F7: 로그아웃 응답이 실패(ok=false)면 이동하지 않고 false를 반환한다", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response);
  const router = mockRouter();

  const result = await performLogout(fetchMock as unknown as typeof fetch, router);

  expect(result).toBe(false);
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.refresh).not.toHaveBeenCalled();
});

test("F7: fetch가 네트워크 오류로 reject해도 예외를 던지지 않고 이동하지 않는다", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
  const router = mockRouter();

  await expect(performLogout(fetchMock as unknown as typeof fetch, router)).resolves.toBe(false);
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.refresh).not.toHaveBeenCalled();
});

// R95/PROTO D의 동작 버전: 문자열 grep이 아니라 실제 호출 인자를 확인한다.
test("F7: 로그아웃 요청은 POST로 /api/v1/auth/logout에 보낸다", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
  const router = mockRouter();

  await performLogout(fetchMock as unknown as typeof fetch, router);

  expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", { method: "POST" });
});
