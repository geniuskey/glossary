import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { recordAuditEvent } from "@/lib/audit";
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

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  return Response.json({ config: publicAiConfig(await loadAiConfig()) });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
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
  await recordAuditEvent({
    action: "admin.ai_config_updated",
    targetType: "ai_config",
    targetId: result.row.id,
    actor: { userId: admin.id },
    metadata: { enabled: result.row.enabled, autoReviewEnabled: result.row.autoReviewEnabled, provider: result.row.provider, model: result.row.model },
  });
  return Response.json({ config: publicAiConfig(result.row) });
});
