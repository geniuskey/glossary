import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getIdentityDisplaySettings, saveIdentityDisplaySettings } from "@/lib/workspace/identity-display";
import { IDENTITY_DISPLAY_LIMITS } from "@/lib/workspace/identity-display-values";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const domain = z.string().trim().toLowerCase().max(IDENTITY_DISPLAY_LIMITS.domain).refine(
  (value) => value === "" || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value),
  "company.com 형태의 도메인을 입력해 주세요.",
);
const settingsSchema = z.object({
  emailDomain: domain,
  organization: z.string().trim().max(IDENTITY_DISPLAY_LIMITS.organization),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.emailDomain) !== Boolean(value.organization)) {
    ctx.addIssue({ code: "custom", message: "이메일 도메인과 조직명을 함께 입력해 주세요." });
  }
});

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return Response.json({ settings: await getIdentityDisplaySettings() });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "담당자 표시 설정을 확인해 주세요.", 400, parsed.error.flatten());
  }
  return Response.json({ settings: await saveIdentityDisplaySettings(parsed.data, admin.id) });
});
