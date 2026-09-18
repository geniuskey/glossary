export const AI_SUGGESTION_GENERATOR_VERSIONS = {
  agent: 3,
  identity: 8,
  definition: 2,
  classification: 2,
  duplicate: 1,
} as const;

export function classificationSuggestionId(kind: "domain" | "category"): string {
  return `classification:${kind}`;
}

export function duplicateSuggestionId(leftTermId: string, rightTermId: string): string {
  const [left, right] = [leftTermId, rightTermId].sort();
  return `duplicate:${left}:${right}`;
}
