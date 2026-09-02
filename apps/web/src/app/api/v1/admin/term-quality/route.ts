import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getTermQualitySettings, saveTermQualitySettings } from "@/lib/workspace/term-quality";
import { TERM_QUALITY_LIMITS } from "@/lib/workspace/term-quality-values";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const settingsSchema = z.object({
  definitionMinChars: z.number().int().min(TERM_QUALITY_LIMITS.min).max(TERM_QUALITY_LIMITS.max),
  bodyMinChars: z.number().int().min(TERM_QUALITY_LIMITS.min).max(TERM_QUALITY_LIMITS.max),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return Response.json({ settings: await getTermQualitySettings() });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "작성 수준 값을 확인해 주세요.", 400, parsed.error.flatten());
  }

  return Response.json({ settings: await saveTermQualitySettings(parsed.data, admin.id) });
});
