import type { DiscoveryNode, DiscoverySignal } from "./signals";

/**
 * 발굴 신호를 사람이 승인할 관계 제안으로 바꾼다.
 *
 * 발굴 품질의 상한은 그래프 밀도다(실데이터: 용어 1,545개에 승인 관계 13개). 신호가 이미 "이 둘은
 * 이어져야 한다"고 말하는 곳을 제안으로 올리면, 사람이 승인할 때마다 다음 발굴이 더 많은 구조를 본다.
 * 승인 없이는 아무것도 바뀌지 않는다 — 제안은 proposed 상태로만 만들고 기존 승인 흐름을 그대로 탄다.
 */

export interface RelationProposal {
  signalId: string;
  kind: "implied" | "latent_link";
  sourceTermId: string;
  targetTermId: string;
  relationType: string;
  confidence: number;
  evidenceMd: string;
}

// 숨은 연결은 관계 종류를 모른다. 근거가 약한 쌍까지 related_to로 올리면 검토자가 승인 피로로
// 전부 거절하거나 전부 승인하게 된다. 아래 중 하나는 넘어야 제안한다.
export const LATENT_PROPOSAL_THRESHOLDS = { commonNeighbors: 3, sharedPages: 3, similarity: 0.8 } as const;

function pair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function nameOf(nodes: ReadonlyMap<string, DiscoveryNode>, id: string): string {
  return nodes.get(id)?.name ?? id;
}

export function relationProposals(
  signals: readonly DiscoverySignal[],
  nodes: ReadonlyMap<string, DiscoveryNode>,
  /** 상태와 무관하게 이미 관계 행이 있는 쌍. 거절된 쌍을 다시 올리면 검토자의 결정을 무시하게 된다. */
  existingPairs: ReadonlySet<string>,
  limit = 30,
): RelationProposal[] {
  const proposals: RelationProposal[] = [];
  const seen = new Set<string>();
  const push = (proposal: RelationProposal) => {
    const key = pair(proposal.sourceTermId, proposal.targetTermId);
    if (seen.has(key) || existingPairs.has(key) || !nodes.has(proposal.sourceTermId) || !nodes.has(proposal.targetTermId)) return;
    seen.add(key);
    proposals.push(proposal);
  };

  for (const signal of signals) {
    if (signal.kind === "implied") {
      const [a, b, c] = signal.termIds as [string, string, string];
      const type = signal.relationType;
      if (!type) continue;
      push({
        signalId: signal.id,
        kind: "implied",
        sourceTermId: a,
        targetTermId: c,
        relationType: type,
        // 두 승인 관계의 약한 쪽보다 높을 수 없다. 추론 한 단계만큼 더 깎는다.
        confidence: Math.max(1, Math.round((signal.metrics.confidence ?? 50) * 0.9)),
        evidenceMd: `추이 관계에서 함의됨: ${nameOf(nodes, a)} → ${nameOf(nodes, b)} → ${nameOf(nodes, c)} (모두 \`${type}\`, 승인된 관계). 발굴 에이전트가 제안했습니다.`,
      });
    } else if (signal.kind === "latent_link") {
      const m = signal.metrics;
      const strong = (m.commonNeighbors ?? 0) >= LATENT_PROPOSAL_THRESHOLDS.commonNeighbors
        || (m.sharedPages ?? 0) >= LATENT_PROPOSAL_THRESHOLDS.sharedPages
        || (m.similarity ?? 0) >= LATENT_PROPOSAL_THRESHOLDS.similarity;
      // 거의 같은 개념은 related_to가 아니라 중복 병합 검토(정리 대기의 중복 후보)로 가야 한다.
      if (!strong || (m.nearDuplicate ?? 0) === 1) continue;
      const [a, b] = signal.termIds as [string, string];
      const confidence = Math.round(Math.min(85, 40 + 10 * (m.commonNeighbors ?? 0) + 5 * Math.min(4, m.sharedPages ?? 0) + 40 * Math.max(0, (m.similarity ?? 0) - 0.6)));
      push({
        signalId: signal.id,
        kind: "latent_link",
        sourceTermId: a,
        targetTermId: b,
        relationType: "related_to",
        confidence,
        evidenceMd: `${signal.summary} 관계 종류는 검토자가 더 구체적으로(is_a, part_of, used_in 등) 바꿀 수 있습니다. 발굴 에이전트가 제안했습니다.`,
      });
    }
    if (proposals.length >= limit) break;
  }
  return proposals;
}

export function relationPairKey(a: string, b: string): string {
  return pair(a, b);
}
