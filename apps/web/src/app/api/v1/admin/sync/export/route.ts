import { apiError, isUuid, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { encodeSyncBundle, syncBundleFilename } from "@/lib/sync/bundle";
import { buildSyncBundle, recordSyncExport, SyncExportError } from "@/lib/sync/export";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "full";
  if (mode !== "full" && mode !== "incremental") {
    return apiError("validation_failed", "mode는 full 또는 incremental이어야 합니다.", 400);
  }
  const base = params.get("base");
  if (base && !isUuid(base)) return apiError("validation_failed", "base는 번들 식별자(UUID)여야 합니다.", 400);

  let bundle;
  try {
    bundle = await buildSyncBundle({ mode, baseBundleId: base, label: params.get("label") ?? undefined, createdBy: admin.id });
  } catch (err) {
    if (err instanceof SyncExportError) return apiError("validation_failed", err.message, 400);
    throw err;
  }
  const bytes = encodeSyncBundle(bundle);
  await recordSyncExport(bundle, bytes.byteLength, admin.id);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${syncBundleFilename(bundle)}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-glossary-sync-bundle": bundle.bundleId,
    },
  });
});
