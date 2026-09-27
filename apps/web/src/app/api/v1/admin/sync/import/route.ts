import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { decodeSyncBundle, MAX_SYNC_BUNDLE_BYTES, SyncBundleError } from "@/lib/sync/bundle";
import { applySyncBundle, SyncImportError } from "@/lib/sync/import";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const TOO_LARGE = `번들이 ${MAX_SYNC_BUNDLE_BYTES / 1024 / 1024}MB를 넘습니다.`;

// 번들은 multipart가 아니라 본문 그대로 받는다. formData()는 파일을 한 번 더 복사하고,
// 이 크기에서는 경계 파싱 비용이 의미 없이 크다.
export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_SYNC_BUNDLE_BYTES) {
    return apiError("payload_too_large", TOO_LARGE, 413);
  }
  const params = new URL(request.url).searchParams;
  const localEdits = params.get("localEdits") ?? "source";
  if (localEdits !== "source" && localEdits !== "keep") {
    return apiError("validation_failed", "localEdits는 source 또는 keep이어야 합니다.", 400);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_SYNC_BUNDLE_BYTES) return apiError("payload_too_large", TOO_LARGE, 413);
  if (bytes.byteLength === 0) return apiError("validation_failed", "요청 본문에 번들 파일이 필요합니다.", 400);

  try {
    const bundle = decodeSyncBundle(bytes);
    const report = await applySyncBundle(bundle, { dryRun: params.get("dryRun") !== "false", localEdits });
    return Response.json({ report });
  } catch (err) {
    if (err instanceof SyncBundleError) return apiError("validation_failed", err.message, 400);
    if (err instanceof SyncImportError) return apiError("operation_conflict", err.message, 409);
    throw err;
  }
});
