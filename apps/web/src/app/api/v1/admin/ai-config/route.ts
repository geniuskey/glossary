import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { scheduleAfterResponse } from "@/lib/after-response";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadAiConfig, publicAiConfig, saveAiConfig } from "@/lib/ai/config";
import { AI_PROVIDERS } from "@/lib/ai/config-values";
import { prepareAutoReviews } from "@/lib/ai/auto-review";
import { listContributionTerms } from "@/lib/terms/query";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const patchSchema = z.object({
  enabled: z.boolean(),
  autoReviewEnabled: z.boolean(),
  provider: z.enum(AI_PROVIDERS),
  baseUrl: z.string().trim().min(1).max(2_000),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4_096).nullable().optional(),
  customHeaders: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    value: z.string().max(4_096),
    configured: z.boolean().optional(),
  }).strict()).max(20),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return Response.json({ config: publicAiConfig(await loadAiConfig()) });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "AI 연결 설정을 확인해 주세요.", 400, parsed.error.flatten());
  const result = await saveAiConfig(parsed.data, admin.id);
  if (!result.ok) return apiError("validation_failed", result.problems[0] ?? "AI 연결 설정을 확인해 주세요.", 400, { formErrors: result.problems });
  if (result.row.enabled && result.row.autoReviewEnabled) {
    scheduleAfterResponse(async () => {
      const queue = await listContributionTerms(60);
      await prepareAutoReviews(queue.items.map((term) => term.id));
    });
  }
  return Response.json({ config: publicAiConfig(result.row) });
});
