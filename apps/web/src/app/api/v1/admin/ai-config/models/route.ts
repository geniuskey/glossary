import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadAiConfig, runtimeAiConfigFromDraft, validateAiConfigInput } from "@/lib/ai/config";
import { AI_PROVIDERS } from "@/lib/ai/config-values";
import { AiProviderError, listAiModels } from "@/lib/ai/provider";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  baseUrl: z.string().trim().min(1).max(2_000),
  apiKey: z.string().max(4_096).nullable().optional(),
  customHeaders: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    value: z.string().max(4_096),
    configured: z.boolean().optional(),
  }).strict()).max(20),
}).strict();

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "모델 목록 연결 정보를 확인해 주세요.", 400, parsed.error.flatten());

  try {
    const config = runtimeAiConfigFromDraft(await loadAiConfig(), parsed.data);
    const problems = validateAiConfigInput({ ...parsed.data, enabled: true, model: "models-list" }, Boolean(config.apiKey));
    for (const header of config.customHeaders) if (!header.value) problems.push(`${header.name} 헤더 값을 입력해 주세요.`);
    if (problems.length > 0) return apiError("validation_failed", problems[0]!, 400, { formErrors: [...new Set(problems)] });
    return Response.json({ models: await listAiModels(config) });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    return apiError("ai_config_error", "저장된 비밀값을 읽지 못했습니다. 암호화 키를 확인해 주세요.", 500);
  }
});
