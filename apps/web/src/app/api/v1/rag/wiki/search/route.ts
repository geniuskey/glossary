import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { AiProviderError } from "@/lib/ai/provider";
import { RagNotReadyError } from "@/lib/rag/search";
import { searchWikiRag } from "@/lib/rag/wiki-search";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const schema = z.object({
  query: z.string().trim().min(1).max(20_000),
  topK: z.number().int().min(1).max(50).optional(),
  domain: z.string().trim().min(1).max(200).nullable().optional(),
  rerank: z.boolean().optional(),
}).strict();

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "위키 RAG 검색 요청을 확인해 주세요.", 400, parsed.error.flatten());
  try {
    const items = await searchWikiRag(parsed.data.query, {
      topK: parsed.data.topK,
      domain: parsed.data.domain ?? undefined,
      rerank: parsed.data.rerank,
      telemetry: {
        traceId: randomUUID(),
        operation: "rag.wiki.search",
        ...(auth.kind === "user" ? { actorId: auth.user.id } : { metadata: { apiKeyId: auth.keyId } }),
      },
    });
    return Response.json({ query: parsed.data.query, items, total: items.length });
  } catch (error) {
    if (error instanceof RagNotReadyError) return apiError("rag_not_ready", error.message, 503);
    if (error instanceof AiProviderError) return apiError("rag_provider_error", error.message, 502);
    throw error;
  }
});
