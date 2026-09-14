import { expect, test } from "vitest";
import { remainingAfterApproval } from "../src/lib/ai/review-continuation";
import type { ContributionSuggestion } from "../src/lib/ai/contribution-suggestions";

const suggestions: ContributionSuggestion[] = [
  { id: "definition", field: "definitionMd", value: "정의 제안", reason: "근거", source: "agent" },
  { id: "domain", field: "domain", value: ["QA"], reason: "근거", source: "agent" },
  { id: "category", field: "category", value: ["design"], reason: "근거", source: "agent" },
];
test("successive approvals remove only the selected item", () => {
  const afterFirst = remainingAfterApproval(suggestions, { definitionMd: "정의 제안" });
  expect(afterFirst?.map((s) => s.id)).toEqual(["domain", "category"]);
  const afterSecond = remainingAfterApproval(afterFirst!, { domain: ["QA"] });
  expect(afterSecond?.map((s) => s.id)).toEqual(["category"]);
  expect(remainingAfterApproval(afterSecond!, { category: ["design"] })).toEqual([]);
});
test("unrelated edits and multi-field patches do not reuse an old review", () => {
  expect(remainingAfterApproval(suggestions, { definitionMd: "직접 쓴 다른 정의" })).toBeNull();
  expect(remainingAfterApproval(suggestions, { definitionMd: "정의 제안", bodyMd: "변경된 근거" })).toBeNull();
});
