import { eq } from "drizzle-orm";
import { attachments } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getDb } from "@/lib/db";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

const SHA256_RE = /^[a-f0-9]{64}$/;

export const GET = withApiErrors(async (
  request: Request,
  { params }: { params: Promise<{ sha256: string }> },
) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const { sha256 } = await params;
  if (!SHA256_RE.test(sha256)) return apiError("not_found", "첨부 이미지를 찾을 수 없습니다.", 404);

  const [row] = await getDb()
    .select({ data: attachments.data, mime: attachments.storedMime, filename: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.sha256, sha256))
    .limit(1);
  if (!row) return apiError("not_found", "첨부 이미지를 찾을 수 없습니다.", 404);

  const etag = `"${sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, max-age=31536000, immutable" } });
  }

  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Content-Length": String(row.data.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
