import { expect, test, vi } from "vitest";
import { performRevert, revertPath } from "../src/lib/terms/revert-request.js";

function okResponse(): Response {
  return { ok: true } as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

test("되돌리기 요청은 POST로 리비전 경로에 보내고 expectedRevision을 싣는다", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());

  await performRevert(fetchMock as unknown as typeof fetch, "black-level", 3, 7);

  expect(fetchMock).toHaveBeenCalledWith("/api/v1/terms/black-level/revisions/3/revert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: 7 }),
  });
});

// 이력 화면을 열어 둔 사이 남이 먼저 고쳤을 때 409로 멈추려면 expectedRevision이
// 반드시 실려야 한다. 빠지면 되돌리기가 남의 편집을 조용히 덮어쓴다.
test("expectedRevision이 본문에서 빠지지 않는다", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());

  await performRevert(fetchMock as unknown as typeof fetch, "black-level", 1, 2);

  const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ expectedRevision: 2 });
});

test("slug는 URL 인코딩해서 붙인다", () => {
  expect(revertPath("한국어 용어", 2)).toBe("/api/v1/terms/%ED%95%9C%EA%B5%AD%EC%96%B4%20%EC%9A%A9%EC%96%B4/revisions/2/revert");
});

test("응답이 ok면 ok:true를 반환한다", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());

  await expect(performRevert(fetchMock as unknown as typeof fetch, "t", 1, 2)).resolves.toEqual({
    ok: true,
  });
});

// 409는 되돌리기에서 가장 흔한 실패다 — 사용자가 "왜 안 됐는지" 알 수 있도록
// 서버가 준 메시지를 그대로 화면에 올린다.
test("에러 봉투의 message를 그대로 돌려준다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      errorResponse(409, { error: { code: "revision_conflict", message: "다른 사람이 먼저 수정했습니다." } }),
    );

  await expect(performRevert(fetchMock as unknown as typeof fetch, "t", 1, 2)).resolves.toEqual({
    ok: false,
    message: "다른 사람이 먼저 수정했습니다.",
  });
});

test("에러 응답이 JSON이 아니면 상태 코드가 담긴 문구로 떨어진다", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response);

  await expect(performRevert(fetchMock as unknown as typeof fetch, "t", 1, 2)).resolves.toEqual({
    ok: false,
    message: "되돌리지 못했습니다 (500).",
  });
});

test("fetch가 네트워크 오류로 reject해도 예외를 던지지 않는다", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

  await expect(performRevert(fetchMock as unknown as typeof fetch, "t", 1, 2)).resolves.toEqual({
    ok: false,
    message: "네트워크 오류로 되돌리지 못했습니다.",
  });
});
