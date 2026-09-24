import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AgentReviewPanel } from "../src/app/contribute/agent-review-panel";
import { ManualReviewButton } from "../src/app/contribute/manual-review-button";
import { termCompletion } from "../src/lib/terms/completion";
import type { ContributionTerm } from "../src/lib/terms/query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const term: ContributionTerm = {
  id: "00000000-0000-4000-8000-000000000001", slug: "cache", nameEn: "Cache", nameKo: "캐시",
  fullNameEn: null, fullNameKo: null, definitionMd: null, bodyMd: null,
  domain: [], categories: [], category: null, categoryLabel: null, categoryLabels: [],
  qualityProfile: "context", topic: null, tags: [], ownerId: null, ownerName: null, status: "draft",
  revision: 2, updatedAt: "2026-09-10T00:00:00Z", completion: termCompletion({ domain: [] }),
};

function reviewMarkup(revision: number, autoReviewEnabled = true) {
  return renderToStaticMarkup(createElement(AgentReviewPanel, {
    initialTerms: [term], autoReviewEnabled, categoryLabels: {},
    initialReviews: { [term.id]: { termId: term.id, revision, suggestions: [] } },
  }));
}

test("수정 전 검토가 남아 있어도 완료나 변경 없음으로 표시하지 않는다", () => {
  const html = reviewMarkup(1);
  expect(html).not.toContain("AI 검토 완료");
  expect(html).not.toContain("제안할 변경이 없습니다");
  expect(html).toContain("자동 검토 준비 중");
});

test("자동 검토가 꺼져 있어도 현재 내용의 수동 검토 결과는 완료로 표시한다", () => {
  const html = reviewMarkup(2, false);
  expect(html).toContain("AI 검토 완료");
  expect(html).toContain("현재 내용에는 제안할 변경이 없습니다");
  expect(html).not.toContain("관리자가 자동 검토를 켜면");
});

test("완료된 수동 검토는 해당 용어 제안으로 바로 연결한다", () => {
  const html = renderToStaticMarkup(createElement(ManualReviewButton, {
    termId: term.id, revision: 2, initialStatus: "ready", aiAvailable: true,
  }));
  expect(html).toContain(`/contribute?tab=agent&amp;termId=${term.id}`);
  expect(html).toContain("제안 보기");
});

test("본문만 있는 용어를 정의에 자동 복사하지 않고 직접 편집 안내를 표시한다", () => {
  const html = renderToStaticMarkup(createElement(AgentReviewPanel, {
    initialTerms: [{ ...term, bodyMd: "캐시는 자주 쓰는 데이터를 임시로 저장하는 방법입니다." }],
    autoReviewEnabled: false, categoryLabels: {}, initialReviews: {},
  }));
  expect(html).toContain("현재 검토할 제안이 없습니다. 직접 편집하거나 정리 대기에서 AI 검토를 요청할 수 있습니다.");
  expect(html).not.toContain("이번에 건너뛰기");
});
