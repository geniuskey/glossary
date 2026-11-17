import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { resolveDomains } from "@/lib/terms/domains";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadDiscoveryGraph } from "@/lib/discovery/load";
import { computeDiscoverySignals, DISCOVERY_SIGNAL_KINDS } from "@/lib/discovery/signals";
import { loadAiConfig, runtimeAiConfig } from "@/lib/ai/config";
import { AiProviderError } from "@/lib/ai/provider";
import { discoverChallenges, MAX_DISCOVERY_IDEAS } from "@/lib/ai/discovery";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

async function resolveDomain(raw: string | null | undefined): Promise<{ label: string | null } | Response> {
  if (!raw) return { label: null };
  const resolved = await resolveDomains([raw]);
  if (resolved.unknown.length) return apiError("validation_failed", "도메인을 찾을 수 없습니다. GET /admin/domains의 key 또는 label을 사용하세요.", 400);
  return { label: resolved.labels[0] ?? null };
}

const signalQuerySchema = z.object({
  domain: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(DISCOVERY_SIGNAL_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  similarity: z.enum(["true", "false"]).default("true"),
});

/**
 * AI를 쓰지 않는 구조 신호. 더 강한 외부 에이전트가 직접 추론하도록 재료만 준다 —
 * 사내 모델의 한계가 발굴 품질의 상한이 되지 않게 하려는 것이다.
 */
export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const parsed = signalQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError("validation_failed", "조회 조건을 확인해 주세요.", 400, parsed.error.flatten());
  const domain = await resolveDomain(parsed.data.domain);
  if (isResponse(domain)) return domain;

  const graph = await loadDiscoveryGraph({ domain: domain.label ?? undefined, withSimilarity: parsed.data.similarity === "true" });
  const computed = computeDiscoverySignals(graph, { transitiveTypes: graph.transitiveTypes, limitPerKind: parsed.data.limit });
  const signals = parsed.data.kind ? computed.signals.filter((signal) => signal.kind === parsed.data.kind) : computed.signals;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const term = (id: string) => {
    const node = byId.get(id);
    return node ? { id: node.id, slug: node.slug, name: node.name, domains: node.domains, definitionChars: node.definitionChars } : { id, slug: null, name: id, domains: [], definitionChars: 0 };
  };
  return Response.json({
    domain: domain.label,
    stats: { ...computed.stats, truncated: graph.truncated },
    signals: signals.map((signal) => ({ ...signal, terms: signal.termIds.map(term), via: signal.viaTermIds.map(term) })),
  });
});

const ideaRequestSchema = z.object({
  focus: z.string().trim().min(1).max(500).nullable().optional(),
  domain: z.string().trim().min(1).max(100).nullable().optional(),
  maxIdeas: z.number().int().min(1).max(MAX_DISCOVERY_IDEAS).optional(),
}).strict();

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const key = auth.kind === "user" ? `user:${auth.user.id}` : `key:${auth.keyId}`;
  // 한 번에 그래프 전체 분석과 긴 생성 두 번을 쓴다. 챗(분당 20회)보다 훨씬 비싸다.
  const limited = rateLimitResponse(await consumeRateLimit(`discovery:${key}`, 6, 10 * 60_000), "발굴은 10분에 6회까지 실행할 수 있습니다. 잠시 후 다시 시도해 주세요.");
  if (limited) return limited;

  const parsed = ideaRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation_failed", "발굴 조건을 확인해 주세요.", 400, parsed.error.flatten());
  const domain = await resolveDomain(parsed.data.domain);
  if (isResponse(domain)) return domain;

  const row = await loadAiConfig();
  if (!row.enabled) return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화하지 않았습니다. AI 없이 쓰려면 GET /api/v1/discovery로 구조 신호를 받으세요.", 503);
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  try {
    const report = await discoverChallenges(runtimeAiConfig(row), { focus: parsed.data.focus, domain: domain.label, maxIdeas: parsed.data.maxIdeas }, undefined, {
      traceId: randomUUID(),
      signal: abort.signal,
      ...(auth.kind === "user" ? { actorId: auth.user.id } : { metadata: { apiKeyId: auth.keyId } }),
    });
    return Response.json(report);
  } catch (error) {
    if (error instanceof AiProviderError) return apiError("ai_provider_error", "AI 응답을 받지 못했습니다. 관리자에게 연결 상태를 확인해 달라고 요청하세요.", 502);
    throw error;
  }
});
