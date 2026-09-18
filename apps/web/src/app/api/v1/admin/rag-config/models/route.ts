import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { AiProviderError, listAiModels } from "@/lib/ai/provider";
import {
  loadRagConfig,
  runtimeRagEndpointFromDraft,
  validateRagHeaders,
  validateRagUrl,
} from "@/lib/rag/config";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  endpoint: z.enum(["embedding", "reranker"]),
  provider: z.literal("openai_compatible").optional(),
  baseUrl: z.string().trim().min(1).max(2_000),
  apiKey: z.string().max(4_096).nullable().optional(),
  customHeaders: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    value: z.string().max(4_096),
    configured: z.boolean().optional(),
  }).strict()).max(20),
}).strict();

/** Returns only models whose IDs advertise the RAG capability being configured. */
export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "RAG 모델 목록 연결 정보를 확인해 주세요.", 400, parsed.error.flatten());

  try {
    const problems = validateRagUrl(parsed.data.baseUrl, "API 주소");
    problems.push(...validateRagHeaders(parsed.data.customHeaders, "RAG"));
    const stored = await loadRagConfig();
    const config = runtimeRagEndpointFromDraft(stored, parsed.data.endpoint, {
      provider: "openai_compatible",
      baseUrl: parsed.data.baseUrl,
      apiKey: parsed.data.apiKey,
      customHeaders: parsed.data.customHeaders,
    });
    for (const header of config.customHeaders) {
      if (!header.value) problems.push(`${header.name} header 값을 입력해 주세요.`);
    }
    if (problems.length > 0) return apiError("validation_failed", problems[0]!, 400, { formErrors: [...new Set(problems)] });

    const models = await listAiModels({
      provider: "openai_compatible",
      baseUrl: config.baseUrl,
      model: "(model-list)",
      apiKey: config.apiKey,
      customHeaders: config.customHeaders,
    }, { operation: `admin.rag-${parsed.data.endpoint}-models`, actorId: admin.id });
    const keyword = parsed.data.endpoint === "embedding" ? "embed" : "reranker";
    return Response.json({ models: models.filter((model) => model.id.toLowerCase().includes(keyword)) });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("rag_provider_error", error.message, 502);
    return apiError("rag_not_ready", "저장된 RAG 비밀값을 읽지 못했습니다. 암호화 키를 확인해 주세요.", 503);
  }
});
