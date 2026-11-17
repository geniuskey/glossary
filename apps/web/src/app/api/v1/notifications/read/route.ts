import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireSessionUser } from "@/lib/auth/require";
import { markNotificationsRead } from "@/lib/notifications/store";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// ids를 빼면 "모두 읽음"이다. 빈 배열은 아무것도 바꾸지 않는다 — 빈 배열을 "전부"로
// 해석하면 선택을 비운 채 보낸 요청이 안 본 알림까지 전부 읽음으로 만든다.
const schema = z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).strict();

export const POST = withApiErrors(async (request: Request) => {
  const user = await requireSessionUser(request);
  if (isResponse(user)) return user;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation_failed", "읽음 처리할 알림을 확인해 주세요.", 400, parsed.error.flatten());
  return Response.json({ updated: await markNotificationsRead(user.id, parsed.data.ids) });
});
