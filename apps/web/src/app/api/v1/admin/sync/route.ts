import { apiError, isUuid, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { forgetSyncSource, getSyncStatus } from "@/lib/sync/status";

const ALLOWED_METHODS = ["GET", "DELETE"];
const { POST, PUT, PATCH, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, OPTIONS };

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  return Response.json(await getSyncStatus(), { headers: { "cache-control": "no-store" } });
});

export const DELETE = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const source = new URL(request.url).searchParams.get("source") ?? "";
  if (!isUuid(source)) return apiError("validation_failed", "source에 출처 서버 식별자(UUID)가 필요합니다.", 400);
  if (!(await forgetSyncSource(source))) return apiError("not_found", "해당 출처 서버의 동기화 기록이 없습니다.", 404);
  return new Response(null, { status: 204 });
});
