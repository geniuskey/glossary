import { z } from "zod/v3";
import { RAG_VECTOR_DIMENSIONS } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getRagIndexStats, queueAllRagTerms, scheduleRagIndexing } from "@/lib/rag/indexer";
import { loadRagConfig, publicRagConfig, saveRagConfig } from "@/lib/rag/config";
import { RAG_EMBEDDING_PROVIDERS, RAG_RERANKER_PROVIDERS } from "@/lib/rag/config-values";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const headerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  value: z.string().max(4_096),
  configured: z.boolean().optional(),
}).strict();

const patchSchema = z.object({
  enabled: z.boolean(),
  // Older clients do not know this opt-in flag. Preserve the stored value
  // instead of silently turning hybrid chat search off on their next save.
  chatEnabled: z.boolean().optional(),
  embeddingProvider: z.enum(RAG_EMBEDDING_PROVIDERS),
  embeddingBaseUrl: z.string().trim().min(1).max(2_000),
  embeddingModel: z.string().trim().min(1).max(200),
  embeddingApiKey: z.string().max(4_096).nullable().optional(),
  embeddingCustomHeaders: z.array(headerSchema).max(20),
  rerankerEnabled: z.boolean(),
  rerankerProvider: z.enum(RAG_RERANKER_PROVIDERS),
  rerankerBaseUrl: z.string().trim().min(1).max(2_000),
  rerankerModel: z.string().trim().min(1).max(200),
  rerankerApiKey: z.string().max(4_096).nullable().optional(),
  rerankerCustomHeaders: z.array(headerSchema).max(20),
  chunkSize: z.number().int().min(400).max(8_000),
  chunkOverlap: z.number().int().min(0).max(2_000),
  topK: z.number().int().min(1).max(50),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const [config, stats] = await Promise.all([loadRagConfig(), getRagIndexStats()]);
  return Response.json({ config: publicRagConfig(config, stats), vectorDimensions: RAG_VECTOR_DIMENSIONS });
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "RAG 검색 설정을 확인해 주세요.", 400, parsed.error.flatten());
  const stored = await loadRagConfig();
  const result = await saveRagConfig({ ...parsed.data, chatEnabled: parsed.data.chatEnabled ?? stored.chatEnabled }, admin.id);
  if (!result.ok) return apiError("validation_failed", result.problems[0] ?? "RAG 검색 설정을 확인해 주세요.", 400, { formErrors: result.problems });

  // Embedding model, endpoint, chunking, and metadata changes all invalidate
  // existing vectors. Queueing is durable; processing happens after the response.
  const queued = result.row.enabled ? await queueAllRagTerms() : 0;
  if (result.row.enabled) scheduleRagIndexing(8);
  const stats = await getRagIndexStats();
  return Response.json({ config: publicRagConfig(result.row, stats), queued, vectorDimensions: RAG_VECTOR_DIMENSIONS });
});
