import { assertSafeAiEndpoint, AiProviderError, readResponseText } from "@/lib/ai/provider";
import { beginAiRun, finishAiRun, providerErrorCode } from "@/lib/ai/telemetry";
import type { AiRunContext } from "@/lib/ai/observability-values";
import type { EmbeddingRuntimeConfig, RerankerRuntimeConfig, StoredRagHeader } from "./config";

export interface RerankResult {
  index: number;
  score: number;
}

function requestHeaders(apiKey: string, headers: StoredRagHeader[], provider: "gemini" | "openai_compatible" | "cohere_compatible"): Headers {
  const result = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (apiKey && provider === "gemini") result.set("x-goog-api-key", apiKey);
  if (apiKey && (provider === "openai_compatible" || provider === "cohere_compatible")) result.set("authorization", `Bearer ${apiKey}`);
  for (const header of headers) result.set(header.name, header.value);
  return result;
}

async function providerError(response: Response, action: string): Promise<AiProviderError> {
  let detail = "";
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (!declaredLength || declaredLength <= 64_000) {
    const raw = await readResponseText(response, 64_000).catch(() => "");
    if (raw.length <= 64_000) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown; detail?: unknown };
        const candidate = parsed.error?.message ?? parsed.message ?? parsed.detail;
        if (typeof candidate === "string") {
          detail = candidate.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        }
      } catch {
        // Do not expose an HTML error page or an unbounded provider response.
      }
    }
  }
  const summary = `RAG 서버가 ${action}을 처리하지 못했습니다 (${response.status}).`;
  return new AiProviderError(detail ? `${summary} ${detail}` : summary, response.status);
}

function waitBeforeRetry(response?: Response): Promise<void> {
  const retryAfter = Number(response?.headers.get("retry-after") || 0);
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 2_000) : 400;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function postJson(
  target: string,
  headers: Headers,
  body: unknown,
  action: string,
  provider: string,
  model: string,
  context: AiRunContext | undefined,
  validate?: (parsed: unknown) => void,
): Promise<unknown> {
  const startedAt = performance.now();
  const run = await beginAiRun({
    ...context,
    operation: context?.operation ?? `rag.${action === "Embedding 요청" ? "embedding" : "rerank"}`,
    provider,
    model,
    inputChars: JSON.stringify(body).length,
  });
  let attempts = 0;
  let lastStatus: number | null = null;
  try {
    await assertSafeAiEndpoint(target);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attempts = attempt + 1;
      let response: Response;
      try {
        response = await fetch(target, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
          redirect: "error",
        });
        lastStatus = response.status;
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (attempt === 0) {
          await waitBeforeRetry();
          continue;
        }
        throw new AiProviderError("RAG 서버에 연결하지 못했습니다.");
      }
      if (!response.ok) {
        if (attempt === 0 && new Set([408, 429, 500, 502, 503, 504]).has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await waitBeforeRetry(response);
          continue;
        }
        throw await providerError(response, action);
      }
      const raw = await readResponseText(response, 8_000_000).catch((error) => {
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError(`RAG 서버가 ${action}에 대한 JSON 응답을 반환하지 않았습니다.`);
      });
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new AiProviderError(`RAG 서버가 ${action}에 대한 JSON 응답을 반환하지 않았습니다.`); }
      validate?.(parsed);
      await finishAiRun(run?.id ?? null, startedAt, {
        status: "succeeded",
        attempts,
        outputChars: JSON.stringify(parsed).length,
        httpStatus: lastStatus,
      });
      return parsed;
    }
    throw new AiProviderError("RAG 서버에 연결하지 못했습니다.");
  } catch (error) {
    await finishAiRun(run?.id ?? null, startedAt, {
      status: "failed",
      attempts,
      httpStatus: lastStatus,
      errorCode: providerErrorCode(error),
      errorMessage: error instanceof Error ? error.message : "RAG 호출에 실패했습니다.",
    });
    throw error;
  }
}

function validateEmbeddingResponse(parsed: unknown, provider: EmbeddingRuntimeConfig["provider"], expectedCount: number, dimensions: number): void {
  const object = parsed && typeof parsed === "object" ? parsed as { embeddings?: unknown; data?: unknown } : {};
  const rows = provider === "gemini"
    ? object.embeddings
    : object.data;
  if (!Array.isArray(rows) || rows.length !== expectedCount) {
    throw new AiProviderError("Embedding 서버가 요청 개수와 다른 응답을 반환했습니다.");
  }
  rows.forEach((row, index) => {
    const values = provider === "gemini"
      ? (row as { values?: unknown })?.values
      : (row as { embedding?: unknown })?.embedding;
    if (!Array.isArray(values) || values.length !== dimensions
      || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new AiProviderError(`Embedding ${index + 1}번 응답의 차원이 ${dimensions}과 다릅니다.`);
    }
  });
}

function validateRerankResponse(parsed: unknown, documentCount: number): void {
  const rows = parsed && typeof parsed === "object" ? (parsed as { results?: unknown }).results : undefined;
  if (!Array.isArray(rows)) throw new AiProviderError("Reranker 서버가 results 배열을 반환하지 않았습니다.");
  for (const row of rows) {
    const index = (row as { index?: unknown })?.index;
    const score = (row as { relevance_score?: unknown; score?: unknown })?.relevance_score
      ?? (row as { score?: unknown })?.score;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= documentCount
      || typeof score !== "number" || !Number.isFinite(score)) {
      throw new AiProviderError("Reranker 서버가 올바르지 않은 결과를 반환했습니다.");
    }
  }
}

function embeddingEndpoint(config: EmbeddingRuntimeConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "gemini") return `${base}/models/${encodeURIComponent(config.model)}:batchEmbedContents`;
  return base.endsWith("/embeddings") ? base : `${base}/embeddings`;
}

/** Calls an OpenAI embeddings endpoint or Gemini batchEmbedContents endpoint. */
export async function embedTexts(config: EmbeddingRuntimeConfig, texts: readonly string[], context?: AiRunContext): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 96) throw new AiProviderError("한 번의 Embedding 요청은 최대 96개 텍스트까지 지원합니다.");
  const target = embeddingEndpoint(config);
  const headers = requestHeaders(config.apiKey, config.customHeaders, config.provider);
  const body = config.provider === "gemini"
    ? {
        requests: texts.map((text) => ({
          model: `models/${config.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: config.dimensions,
        })),
      }
    : { model: config.model, input: texts, encoding_format: "float", dimensions: config.dimensions };
  const parsed = await postJson(
    target,
    headers,
    body,
    "Embedding 요청",
    config.provider,
    config.model,
    context,
    (value) => validateEmbeddingResponse(value, config.provider, texts.length, config.dimensions),
  );
  const rows = (config.provider === "gemini"
    ? (parsed as { embeddings?: unknown }).embeddings
    : (parsed as { data?: unknown }).data) as Array<{ values?: unknown; embedding?: unknown }>;
  return rows.map((row, index) => {
    const values = config.provider === "gemini"
      ? (row as { values?: unknown })?.values
      : (row as { embedding?: unknown })?.embedding;
    return values as number[];
  });
}

function rerankEndpoint(config: RerankerRuntimeConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  return base.endsWith("/rerank") ? base : `${base}/rerank`;
}

/** Calls a Cohere v2/Jina/OpenAI-compatible rerank endpoint. */
export async function rerankTexts(
  config: RerankerRuntimeConfig,
  query: string,
  documents: readonly string[],
  context?: AiRunContext,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  if (documents.length > 100) throw new AiProviderError("한 번의 Reranker 요청은 최대 100개 문서까지 지원합니다.");
  const parsed = await postJson(
    rerankEndpoint(config),
    requestHeaders(config.apiKey, config.customHeaders, config.provider),
    { model: config.model, query, documents, top_n: documents.length, return_documents: false },
    "Reranker 요청",
    config.provider,
    config.model,
    context,
    (value) => validateRerankResponse(value, documents.length),
  );
  const rows = (parsed as { results?: unknown }).results as Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>;
  return rows.flatMap((row) => {
    const index = (row as { index?: unknown })?.index;
    const score = (row as { relevance_score?: unknown; score?: unknown })?.relevance_score
      ?? (row as { score?: unknown })?.score;
    return [{ index: index as number, score: score as number }];
  });
}
