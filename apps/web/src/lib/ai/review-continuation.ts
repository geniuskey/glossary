import type { ContributionSuggestion } from "./contribution-suggestions";

/** Only an exact, single-field approval may carry the remaining review forward. */
export function remainingAfterApproval(suggestions: ContributionSuggestion[], patch: Record<string, unknown>, rules: ContributionSuggestion[] = []): ContributionSuggestion[] | null {
  const keys = Object.keys(patch);
  if (keys.length !== 1) return null;
  const accepted = [...suggestions, ...rules].find((item) => item.field === keys[0]
    && item.field !== "relation" && JSON.stringify(item.value) === JSON.stringify(patch[keys[0]!]));
  return accepted ? suggestions.filter((item) => item.id !== accepted.id) : null;
}
