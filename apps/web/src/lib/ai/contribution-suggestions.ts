export const CONTRIBUTION_RELATION_TYPES = ["related_to", "is_a", "part_of", "used_in", "prerequisite_of", "replaces"] as const;
export type ContributionRelationType = typeof CONTRIBUTION_RELATION_TYPES[number];
export type ContributionSuggestionField = "definitionMd" | "domain" | "category" | "relation";
export type ContributionSuggestionSource = "rule" | "agent";

export interface TermContributionSuggestion {
  id: string;
  field: Exclude<ContributionSuggestionField, "relation">;
  value: string | string[];
  reason: string;
  source: ContributionSuggestionSource;
}

export interface RelationContributionSuggestion {
  id: string;
  field: "relation";
  value: {
    relationId?: string;
    targetTermId: string;
    targetSlug: string;
    targetName: string;
    relationType: ContributionRelationType;
    confidence: number;
  };
  reason: string;
  source: "agent";
}

export type ContributionSuggestion = TermContributionSuggestion | RelationContributionSuggestion;

export interface SuggestibleTerm {
  id: string;
  definitionMd: string | null;
  bodyMd: string | null;
  domain: string[];
  categories: string[];
}

function firstUsefulSentence(markdown: string): string | null {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*>]+\s*/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  const sentence = plain.match(/^.*?(?:[.!?]|다\.|요\.|임\.|함\.|됨\.)(?=\s|$)/)?.[0] ?? plain;
  const normalized = sentence.trim();
  return normalized.length >= 12 ? normalized.slice(0, 1_000) : null;
}

/** 저장된 본문만으로 안전하게 만들 수 있는 결정적 제안. LLM이 꺼져 있어도 동작한다. */
export function buildRuleSuggestions(term: SuggestibleTerm): ContributionSuggestion[] {
  if (term.definitionMd?.trim() || !term.bodyMd?.trim()) return [];
  const definition = firstUsefulSentence(term.bodyMd);
  if (!definition) return [];
  return [{
    id: `rule-definition-${term.id}`,
    field: "definitionMd",
    value: definition,
    reason: "본문의 첫 번째 설명 문장을 한줄 정의 후보로 가져왔습니다.",
    source: "rule",
  }];
}

export function suggestionPatch(suggestion: ContributionSuggestion): Record<string, string | string[]> {
  if (suggestion.field === "relation") throw new Error("관계 제안은 용어 필드 patch로 변환할 수 없습니다.");
  return { [suggestion.field]: suggestion.value };
}
