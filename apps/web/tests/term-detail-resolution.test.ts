import { beforeEach, expect, test, vi } from "vitest";
import type { TermSummary } from "../src/lib/terms/query";

vi.mock("@/components/app-shell", () => ({ AppShell: vi.fn() }));
vi.mock("@/lib/terms/query", () => ({ listRelatedTerms: vi.fn(async () => []) }));
vi.mock("@/lib/workspace/term-quality", () => ({ getTermQualitySettings: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => ({ id: "viewer" })) }));
vi.mock("@/lib/terms/page-metadata", () => ({ loadTermForPage: vi.fn(async () => null) }));
vi.mock("@/lib/terms/lookup", () => ({ lookupTerms: vi.fn() }));
vi.mock("@/lib/terms/merge", () => ({ mergedDestination: vi.fn(async () => null) }));
vi.mock("@/lib/wiki/store", () => ({ listWikiPagesForTerm: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
  notFound: () => { throw new Error("not-found"); },
}));

const { lookupTerms } = await import("../src/lib/terms/lookup");
const { TermDetailPage } = await import("../src/components/term-detail-page");

function candidate(id: string, nameEn: string, nameKo: string | null = null): TermSummary {
  return { id, slug: `concept-${id}`, nameEn, nameKo } as TermSummary;
}
function open(slug: string) {
  return TermDetailPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
}
function matches(terms: TermSummary[]) {
  vi.mocked(lookupTerms).mockResolvedValue([{ text: "PM", found: true, matchKind: "alias", terms, similar: [] }]);
}
beforeEach(() => vi.clearAllMocks());

test("여러 별칭과 겹쳐도 대표명이 유일하게 일치하면 해당 용어를 연다", async () => {
  matches([candidate("a", "Project Manager"), candidate("b", "PM"), candidate("c", "Product Manager")]);
  await expect(open("pm")).rejects.toThrow("redirect:/g/concept-b?from=pm");
});

test("국문 대표명도 인코딩된 주소에서 우선한다", async () => {
  matches([candidate("a", "Project Manager"), candidate("b", "PM", "관리자")]);
  await expect(open(encodeURIComponent("관리자"))).rejects.toThrow(`redirect:/g/concept-b?from=${encodeURIComponent("관리자")}`);
});

test("별칭만 공유하면 선택 화면을 유지한다", async () => {
  matches([candidate("a", "Project Manager"), candidate("b", "Product Manager")]);
  const page = await open("pm");
  expect(page.props.terms).toHaveLength(2);
});

test("대표명도 여러 용어가 공유하면 선택 화면을 유지한다", async () => {
  matches([candidate("a", "PM"), candidate("b", "PM")]);
  const page = await open("pm");
  expect(page.props.terms).toHaveLength(2);
});
