export const EDIT_REVIEW_FIELDS = [
  "nameEn",
  "nameKo",
  "fullNameEn",
  "fullNameKo",
  "definitionMd",
  "bodyMd",
  "domain",
  "category",
  "topic",
] as const;

export type EditReviewField = typeof EDIT_REVIEW_FIELDS[number];
export type EditReviewSeverity = "warning" | "info";
export type EditReviewKind = "typo" | "contradiction" | "consistency" | "missing";

export interface EditReviewSource {
  slug: string;
  title: string;
}

export interface EditReviewFinding {
  id: string;
  kind: EditReviewKind;
  severity: EditReviewSeverity;
  title: string;
  description: string;
  sources: EditReviewSource[];
}

export interface EditReviewSuggestion {
  id: string;
  field: EditReviewField;
  value: string | string[];
  reason: string;
  sources: EditReviewSource[];
}

export interface EditReviewRelation {
  id: string;
  targetSlug: string;
  targetName: string;
  relationType: "related_to" | "is_a" | "part_of" | "used_in" | "prerequisite_of" | "replaces";
  confidence: number;
  reason: string;
}

export interface EditReviewResult {
  summary: string;
  findings: EditReviewFinding[];
  suggestions: EditReviewSuggestion[];
  relations: EditReviewRelation[];
  sources: EditReviewSource[];
}
