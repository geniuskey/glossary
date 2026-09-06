import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const contributeDir = path.join(testDir, "..", "src", "app", "contribute");

test("검토 큐의 제안 보기는 해당 용어를 제안 검토 화면에 전달한다", () => {
  const queuePanel = readFileSync(path.join(contributeDir, "review-queue-panel.tsx"), "utf8");
  const page = readFileSync(path.join(contributeDir, "page.tsx"), "utf8");
  const reviewPanel = readFileSync(path.join(contributeDir, "agent-review-panel.tsx"), "utf8");

  expect(queuePanel).toContain("tab=agent&termId=${encodeURIComponent(item.termId)}");
  expect(page).toContain("listContributionTerms(60, user.id, selectedTermId)");
  expect(page).toContain("initialTermId={selectedTermId}");
  expect(reviewPanel).toContain("term.id === initialTermId");
  expect(reviewPanel.indexOf("term.id === initialTermId")).toBeLessThan(reviewPanel.indexOf("const actionable"));
});
