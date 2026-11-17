import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { resolveDomains } from "@/lib/terms/domains";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadAiConfig, runtimeAiConfig } from "@/lib/ai/config";
import { AiProviderError } from "@/lib/ai/provider";
import { curateTermRelations } from "@/lib/ai/relation-curation";
import { loadDiscoveryGraph } from "@/lib/discovery/load";
import { selectConceptTerms } from "@/lib/discovery/curation";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// 용어 하나에 모델 호출 하나(로컬 27B 모델 약 30초)라서 한 요청은 10개까지다. 전체 용어집은 nextOffset으로 이어 부른다.
const MAX_TERMS_PER_REQUEST = 10;

const requestSchema = z.object({
  termSlugs: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_TERMS_PER_REQUEST).optional(),
  domain: z.string().trim().min(1).max(100).nullable().optional(),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(MAX_TERMS_PER_REQUEST).default(5),
  maxPerTerm: z.number().int().min(1).max(5).default(3),
  dryRun: z.boolean().default(true),
}).strict();

/**
 * 개념 용어마다 임베딩 이웃의 정의를 비교해 성립하는 관계만 제안한다(scripts/curate-relations.ts와 같은 규칙).
 * 사람과 에이전트 모두 제안할 수 있고, 저장해도 proposed다. 승인은 관계 검토에서 사람이 한다.
 */
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const actorKey = auth.kind === "user" ? `user:${auth.user.id}` : `key:${auth.keyId}`;
  const limited = rateLimitResponse(await consumeRateLimit(`discovery-curate:${actorKey}`, 30, 60 * 60_000), "관계 정리는 한 시간에 30회까지 요청할 수 있습니다.");
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation_failed", "정리 조건을 확인해 주세요.", 400, parsed.error.flatten());
  let domain: string | undefined;
  if (parsed.data.domain) {
    const resolved = await resolveDomains([parsed.data.domain]);
    if (resolved.unknown.length) return apiError("validation_failed", "도메인을 찾을 수 없습니다.", 400);
    domain = resolved.labels[0];
  }
  const row = await loadAiConfig();
  if (!row.enabled) return apiError("ai_not_enabled", "관리자가 AI 연결을 활성화하지 않았습니다.", 503);

  const graph = await loadDiscoveryGraph({ domain, withSimilarity: false });
  let targets: Array<{ id: string; slug: string; name: string }>;
  let nextOffset: number | null = null;
  let total: number;
  if (parsed.data.termSlugs) {
    const bySlug = new Map(graph.nodes.map((node) => [node.slug, node]));
    const missing = parsed.data.termSlugs.filter((slug) => !bySlug.has(slug));
    if (missing.length) return apiError("validation_failed", "없는 용어 slug가 있습니다.", 400, { missingTermSlugs: missing });
    targets = parsed.data.termSlugs.map((slug) => bySlug.get(slug)!);
    total = targets.length;
  } else {
    // selectConceptTerms의 순서는 결정적이라 offset으로 이어 부를 수 있다.
    const all = selectConceptTerms(graph.nodes, Number.MAX_SAFE_INTEGER);
    total = all.length;
    targets = all.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit);
    if (parsed.data.offset + targets.length < all.length) nextOffset = parsed.data.offset + targets.length;
  }

  const config = runtimeAiConfig(row);
  const telemetry = { traceId: randomUUID(), ...(auth.kind === "user" ? { actorId: auth.user.id } : { metadata: { apiKeyId: auth.keyId } }) };
  const proposer = auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId };
  const items = [];
  for (const term of targets) {
    try {
      const outcome = await curateTermRelations(config, term.id, { dryRun: parsed.data.dryRun, proposer, maxPerTerm: parsed.data.maxPerTerm, telemetry });
      items.push({
        term: { id: term.id, slug: term.slug, name: term.name },
        candidates: outcome?.candidates ?? 0,
        relations: (outcome?.judgments ?? []).map((judgment) => {
          const candidate = { id: judgment.candidate.termId, name: judgment.candidate.name };
          const self = { id: term.id, name: term.name };
          const [source, target] = judgment.direction === "forward" ? [self, candidate] : [candidate, self];
          return { source, target, relationType: judgment.relationType, confidence: judgment.confidence, evidence: judgment.evidence, similarity: judgment.candidate.similarity, outcome: judgment.outcome };
        }),
      });
    } catch (error) {
      // 한 용어의 실패로 앞서 저장한 제안까지 잃지 않게 항목별로 기록하고 계속한다.
      if (!(error instanceof AiProviderError)) throw error;
      items.push({ term: { id: term.id, slug: term.slug, name: term.name }, candidates: 0, relations: [], error: error.message });
    }
  }
  return Response.json({ dryRun: parsed.data.dryRun, total, offset: parsed.data.termSlugs ? 0 : parsed.data.offset, nextOffset, items });
});
