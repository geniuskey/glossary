import { inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v3";
import { termRelations, termRevisions } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import { resolveDomains } from "@/lib/terms/domains";
import { createRelation } from "@/lib/terms/relations";
import { RELATION_TYPES, type RelationType } from "@/lib/terms/relation-values";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadDiscoveryGraph } from "@/lib/discovery/load";
import { computeDiscoverySignals } from "@/lib/discovery/signals";
import { relationPairKey, relationProposals } from "@/lib/discovery/proposals";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  domain: z.string().trim().min(1).max(100).nullable().optional(),
  kinds: z.array(z.enum(["implied", "latent_link"])).min(1).max(2).default(["implied", "latent_link"]),
  limit: z.number().int().min(1).max(50).default(20),
  // 기본은 미리보기다. 한 번에 수십 개 제안을 만들면 검토 대기열이 갑자기 불어난다.
  dryRun: z.boolean().default(true),
}).strict();

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  // POST /relations와 같은 규칙: 제안은 사람과 에이전트(API 키) 모두 할 수 있고, 승인은 사람만 한다.
  const proposer = auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId };
  const limited = rateLimitResponse(await consumeRateLimit(`discovery-relations:${auth.kind === "user" ? auth.user.id : auth.keyId}`, 10, 10 * 60_000), "잠시 후 다시 시도해 주세요.");
  if (limited) return limited;

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("validation_failed", "제안 조건을 확인해 주세요.", 400, parsed.error.flatten());
  let domain: string | undefined;
  if (parsed.data.domain) {
    const resolved = await resolveDomains([parsed.data.domain]);
    if (resolved.unknown.length) return apiError("validation_failed", "도메인을 찾을 수 없습니다.", 400);
    domain = resolved.labels[0];
  }

  const graph = await loadDiscoveryGraph({ domain });
  const computed = computeDiscoverySignals(graph, { transitiveTypes: graph.transitiveTypes, limitPerKind: 100 });
  const signals = computed.signals.filter((signal) => (parsed.data.kinds as string[]).includes(signal.kind));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));

  const touched = [...new Set(signals.flatMap((signal) => signal.termIds))];
  const existingPairs = new Set<string>();
  if (touched.length) {
    // 승인된 관계만 담은 그래프로는 부족하다. 제안 중·거절된 쌍도 다시 올리지 않는다.
    const rows = await getDb().select({ source: termRelations.sourceTermId, target: termRelations.targetTermId }).from(termRelations)
      .where(or(inArray(termRelations.sourceTermId, touched), inArray(termRelations.targetTermId, touched)));
    for (const row of rows) existingPairs.add(relationPairKey(row.source, row.target));
  }
  const proposals = relationProposals(signals, nodes, existingPairs, parsed.data.limit)
    .filter((proposal) => (RELATION_TYPES as readonly string[]).includes(proposal.relationType));
  const describe = (id: string) => ({ id, slug: nodes.get(id)?.slug ?? null, name: nodes.get(id)?.name ?? id });
  const items = proposals.map((proposal) => ({ ...proposal, source: describe(proposal.sourceTermId), target: describe(proposal.targetTermId) }));
  if (parsed.data.dryRun) return Response.json({ dryRun: true, items });

  const ids = [...new Set(proposals.flatMap((proposal) => [proposal.sourceTermId, proposal.targetTermId]))];
  const revisions = ids.length ? await getDb().select({ termId: termRevisions.termId, revision: sql<number>`max(${termRevisions.revisionNumber})::int` })
    .from(termRevisions).where(inArray(termRevisions.termId, ids)).groupBy(termRevisions.termId) : [];
  const revisionOf = new Map(revisions.map((row) => [row.termId, row.revision]));
  const results = [];
  for (const item of items) {
    // 리비전은 바로 위에서 읽었지만 createRelation이 잠금 안에서 다시 대조한다. 그 사이 용어가 바뀌면 stale로 건너뛴다.
    const outcome = await createRelation({
      sourceTermId: item.sourceTermId,
      targetTermId: item.targetTermId,
      relationType: item.relationType as RelationType,
      evidenceMd: item.evidenceMd,
      confidence: item.confidence,
      sourceRevision: revisionOf.get(item.sourceTermId) ?? 0,
      targetRevision: revisionOf.get(item.targetTermId) ?? 0,
    }, proposer);
    results.push({ ...item, outcome: "ok" in outcome ? "proposed" : outcome.error, ...("ok" in outcome ? { relationId: outcome.id } : {}) });
  }
  return Response.json({ dryRun: false, items: results });
});
