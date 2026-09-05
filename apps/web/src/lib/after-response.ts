import { after } from "next/server";

/** Next 요청 응답 뒤에 실행하되, Route Handler를 직접 호출하는 단위 테스트에서는 등록하지 않는다. */
export function scheduleAfterResponse(callback: () => void | Promise<unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  after(async () => { await callback(); });
}
