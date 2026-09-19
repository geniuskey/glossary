import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { randomUUID } from "node:crypto";
import { AiProviderError } from "@/lib/ai/provider";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadRagConfig, runtimeEmbeddingConfig, runtimeRerankerConfig } from "@/lib/rag/config";
import { embedTexts, rerankTexts } from "@/lib/rag/provider";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;
  const config = await loadRagConfig();
  try {
    const traceId = randomUUID();
    await embedTexts(runtimeEmbeddingConfig(config), ["Glossary RAG 연결 테스트"], { traceId, actorId: admin.id, operation: "admin.rag-embedding-test" });
    if (config.rerankerEnabled) {
      await rerankTexts(runtimeRerankerConfig(config), "연결 테스트", ["Glossary RAG 연결 테스트 문서"], { traceId, actorId: admin.id, operation: "admin.rag-reranker-test" });
    }
    return Response.json({ ok: true, embedding: true, reranker: config.rerankerEnabled });
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("rag_provider_error", error.message, 502);
    return apiError("rag_not_ready", "저장된 RAG 비밀값을 읽을 수 없습니다. 암호화 키를 확인해 주세요.", 503);
  }
});
