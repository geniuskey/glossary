// R130: 되돌리기 버튼(history/revert-button.tsx)은 Client Component라 jsdom이
// 없는 이 저장소(R97)에서는 렌더 테스트를 할 수 없다. logout.ts/form-payload.ts와
// 같은 패턴으로 "무엇을 어떻게 보내는가"를 순수 함수로 빼고, fetch를 주입해
// 호출 인자와 분기를 테스트한다(tests/revert-request.test.ts).

export interface RevertOutcome {
  ok: boolean;
  message?: string;
}

export function revertPath(slug: string, revisionNumber: number): string {
  // slug는 사용자가 만든 이름에서 파생되므로 그대로 URL에 이어 붙이지 않는다.
  return `/api/v1/terms/${encodeURIComponent(slug)}/revisions/${revisionNumber}/revert`;
}

/**
 * expectedRevision을 항상 함께 보낸다. 이력 화면을 열어 둔 채 다른 사람이 먼저
 * 고쳤다면, 그 사람의 수정 위에 옛 내용을 덮어쓰는 대신 409로 멈춰야 한다 —
 * 되돌리기가 남의 편집을 조용히 지우는 도구가 되면 개방 편집이 성립하지 않는다.
 */
export async function performRevert(
  fetchImpl: typeof fetch,
  slug: string,
  revisionNumber: number,
  expectedRevision: number,
): Promise<RevertOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(revertPath(slug, revisionNumber), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    });
  } catch {
    return { ok: false, message: "네트워크 오류로 되돌리지 못했습니다." };
  }

  if (res.ok) return { ok: true };

  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return {
    ok: false,
    message: body?.error?.message ?? `되돌리지 못했습니다 (${res.status}).`,
  };
}
