import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadAiConfig, runtimeAiConfig } from "@/lib/ai/config";
import { AiProviderError, completeAi } from "@/lib/ai/provider";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  try {
    const config = runtimeAiConfig(await loadAiConfig());
    await completeAi(config, [
      { role: "system", content: "연결 확인 요청입니다." },
      { role: "user", content: "OK라고만 답하세요." },
    ], 128);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("ai_provider_error", error.message, 502);
    return apiError("ai_config_error", "저장된 비밀값을 읽지 못했습니다. 암호화 키를 확인해 주세요.", 500);
  }
});
