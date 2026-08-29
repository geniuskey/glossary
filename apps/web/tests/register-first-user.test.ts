import { expect, test, vi } from "vitest";

// 계정이 하나도 없는 설치에서는 가입 창구가 닫혀 있어야 한다 — 첫 계정은
// /setup이 관리자로 만든다. 여기서 열려 있으면 사전을 만든 첫 사람이 editor가
// 되고 관리자가 영영 없는 설치가 된다(삭제·키 발급을 아무도 못 한다).
//
// 실제 DB를 비우면 같은 테스트 DB를 쓰는 다른 파일까지 흔들리므로, 이 파일에서만
// needsSetup을 모킹해 그 상태를 만든다.
vi.mock("@/lib/auth/setup", () => ({
  needsSetup: async () => true,
  createFirstAdmin: async () => {
    throw new Error("이 테스트에서는 호출되지 않아야 한다");
  },
}));

const { POST: registerPost } = await import("../src/app/api/v1/auth/register/route.js");

test("계정이 하나도 없으면 가입은 403이고 최초 설정으로 안내한다", async () => {
  const res = await registerPost(
    new Request("http://x/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "first@example.com", password: "hunter2hunter2" }),
    }),
  );

  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("forbidden");
  expect(body.error.message).toContain("최초 관리자");
});
