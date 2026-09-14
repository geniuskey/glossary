import { RELATION_TYPES } from "@/lib/terms/relation-values";
export const CONTRIBUTION_RELATION_TYPES = RELATION_TYPES;
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

/** 의미를 판단하지 못하는 규칙으로 본문을 정의에 복사하지 않는다. */
export function buildRuleSuggestions(_term: SuggestibleTerm): ContributionSuggestion[] {
  return [];
}

export function suggestionPatch(suggestion: ContributionSuggestion): Record<string, string | string[]> {
  if (suggestion.field === "relation") throw new Error("관계 제안은 용어 필드 patch로 변환할 수 없습니다.");
  return { [suggestion.field]: suggestion.value };
}
