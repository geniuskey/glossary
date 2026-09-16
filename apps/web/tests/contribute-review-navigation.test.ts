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
  const queueTable = readFileSync(path.join(contributeDir, "contribution-queue-table.tsx"), "utf8");

  expect(queuePanel).toContain("tab=agent&termId=${encodeURIComponent(item.termId)}");
  expect(page).toContain('const contributionLimit = tab === "agent" ? AGENT_REVIEW_LIST_LIMIT : 60;');
  expect(page).toContain('listContributionTerms(contributionLimit, user.id, selectedTermId, { includePrepared: tab === "agent", preservePreferredOrder: tab === "agent" })');
  expect(page).toContain('{tab !== "agent" && tab !== "definitions" && (');
  expect(page).not.toContain('tab === "agent" ? "현재 값과 제안을 비교한 뒤 필요한 변경만 승인하세요."');
  expect(page).toContain("ContributionQueueTable");
  expect(queueTable).toContain('<table className="w-full table-fixed border-collapse text-left text-sm">');
  expect(queueTable).toContain('<th scope="col" className="w-[30%] border-b border-line px-2 py-3 font-semibold md:w-[26%]">필요한 정보</th>');
  expect(queueTable).toContain("일괄 AI 검토 요청");
  expect(queueTable).not.toContain("min-w-[70rem]");
  expect(queueTable).not.toContain("overflow-x-auto");
  expect(queueTable).not.toContain('<ul className="grid gap-3 md:grid-cols-2">');
  expect(page).toContain("initialTermId={selectedTermId}");
  expect(page).toContain("totalTerms={queue.total}");
  expect(page).toContain('current="contribute" roomy>');
  expect(reviewPanel).toContain("term.id === initialTermId");
  expect(reviewPanel).toContain("AgentTermList");
  expect(reviewPanel).toContain("router.replace(`/contribute?tab=agent&termId=");
  expect(reviewPanel.indexOf("term.id === initialTermId")).toBeLessThan(reviewPanel.indexOf("const actionable"));
});
