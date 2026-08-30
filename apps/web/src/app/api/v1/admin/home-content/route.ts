import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getHomeContent, saveHomeContent } from "@/lib/workspace/home-content";
import { HOME_CONTENT_LIMITS } from "@/lib/workspace/home-content-values";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const contentSchema = z.object({
  eyebrow: z.string().trim().min(1).max(HOME_CONTENT_LIMITS.eyebrow),
  title: z.string().trim().min(1).max(HOME_CONTENT_LIMITS.title),
  description: z.string().trim().min(1).max(HOME_CONTENT_LIMITS.description),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return Response.json({ settings: await getHomeContent() });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const parsed = contentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "홈 소개 문구를 확인해 주세요.", 400, parsed.error.flatten());
  }

  return Response.json({ settings: await saveHomeContent(parsed.data, admin.id) });
});
