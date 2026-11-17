import { methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireSessionUser } from "@/lib/auth/require";
import { listNotifications } from "@/lib/notifications/store";
import type { NotificationListResponse } from "@/lib/notifications/wire";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

// 알림은 사람에게 오는 것이라 API 키로는 읽지 않는다. 키에는 받는 사람이 없다.
export const GET = withApiErrors(async (request: Request) => {
  const user = await requireSessionUser(request);
  if (isResponse(user)) return user;
  const payload: NotificationListResponse = await listNotifications(user.id);
  return Response.json(payload);
});
