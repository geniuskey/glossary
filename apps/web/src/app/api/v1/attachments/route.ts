import { attachments } from "@grossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import {
  IMAGE_UPLOAD_CONTENT_LENGTH_SLOP,
  ImageProcessingError,
  MAX_IMAGE_INPUT_BYTES,
  processImage,
  safeOriginalFilename,
} from "@/lib/attachments/image";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(contentLength)
    && contentLength > MAX_IMAGE_INPUT_BYTES + IMAGE_UPLOAD_CONTENT_LENGTH_SLOP
  ) {
    return apiError("payload_too_large", "원본 이미지는 10MB 이하여야 합니다.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("validation_failed", "요청 본문이 올바른 form-data 형식이 아닙니다.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("validation_failed", "file 필드에 이미지가 필요합니다.", 400);
  }
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    return apiError("payload_too_large", "원본 이미지는 10MB 이하여야 합니다.", 413);
  }

  let image;
  try {
    image = await processImage(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      return apiError(
        error.code === "too_large" ? "payload_too_large" : "validation_failed",
        error.message,
        error.code === "too_large" ? 413 : 400,
      );
    }
    throw error;
  }

  const originalFilename = safeOriginalFilename(file.name);
  const uploadedBy = auth.kind === "user" ? auth.user.id : null;
  const inserted = await getDb()
    .insert(attachments)
    .values({
      sha256: image.sha256,
      data: image.data,
      storedMime: image.storedMime,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      originalFilename,
      originalMime: file.type || "application/octet-stream",
      originalBytes: file.size,
      uploadedBy,
    })
    .onConflictDoNothing({ target: attachments.sha256 })
    .returning({ id: attachments.id });

  return Response.json(
    {
      sha256: image.sha256,
      url: `/api/v1/attachments/${image.sha256}`,
      mime: image.storedMime,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      originalFilename,
    },
    { status: inserted.length > 0 ? 201 : 200 },
  );
});
