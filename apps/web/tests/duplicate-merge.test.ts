import { afterAll, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { aiReviewSuggestions, aiReviewQueue, termRelations, terms, termRevisions } from "@glossary/db";
import { getDb } from "../src/lib/db";
import { createTerm } from "../src/lib/terms/create";
import { updateTerm, currentRevisionNumber } from "../src/lib/terms/update";
import { mergeTerms, mergedDestination } from "../src/lib/terms/merge";
import { getTermByIdOrSlug, listContributionTerms, listPublishedTermRows } from "../src/lib/terms/query";
import { lookupTerms } from "../src/lib/terms/lookup";
import { getPreparedReview, decidePreparedRelationSuggestion } from "../src/lib/ai/auto-review";
import { duplicateCandidates } from "../src/lib/ai/duplicate-review";

const ids: string[] = [];
const suffix = Date.now().toString(36);
async function term(name: string, definition = "", body = "") {
  const result = await createTerm({ nameEn: `${name}${suffix}`, definitionMd: definition, bodyMd: body, domain: ["QA"], category: [], surfaces: [], qualityProfile: "auto" }, null);
  ids.push(result.term.id); return result.term;
}
afterAll(async () => { if (ids.length) await getDb().delete(terms).where(inArray(terms.id, ids)); });

test("field approvals persist the rest across revisions, including a later relation decision", async () => {
  const source = await term("Sequential"), target = await term("RelationTarget");
  const [relation] = await getDb().insert(termRelations).values({ sourceTermId: source.id, targetTermId: target.id, relationType: "used_in", status: "proposed", sourceRevision: 1, targetRevision: 1, confidence: 90, evidenceMd: "관련 근거" }).returning();
  await getDb().insert(aiReviewSuggestions).values({ termId: source.id, revision: 1, generatorVersion: 3, suggestions: [
    { id: "first", source: "agent", field: "definitionMd", value: "이것은 연속 승인에 사용하는 충분한 길이의 정의입니다.", reason: "본문 근거" },
    { id: "second", source: "agent", field: "domain", value: ["QA", "HW"], reason: "분류 근거" },
    { id: "third", source: "agent", field: "relation", value: { relationId: relation!.id, targetTermId: target.id, targetSlug: target.slug, targetName: target.nameEn, relationType: "used_in", confidence: 90 }, reason: "관련 근거" },
  ] });
  await getDb().insert(aiReviewQueue).values({ termId: source.id, revision: 1, status: "ready", requestMode: "manual" });
  expect(await updateTerm(source.id, { definitionMd: "이것은 연속 승인에 사용하는 충분한 길이의 정의입니다." }, null, 1)).toHaveProperty("term");
  expect((await getPreparedReview(source.id, 2))?.suggestions.map((s) => s.id)).toEqual(["second", "third"]);
  expect((await listContributionTerms(60, undefined, source.id, { includePrepared: true })).items.map((s) => s.id)).toContain(source.id);
  expect(await updateTerm(source.id, { domain: ["QA", "HW"] }, null, 2)).toHaveProperty("term");
  expect((await getPreparedReview(source.id, 3))?.suggestions.map((s) => s.id)).toEqual(["third"]);
  expect(await decidePreparedRelationSuggestion({ termId: source.id, revision: 3, suggestionId: "third", decision: "approved", reviewedBy: null })).toBe(true);
  expect((await getPreparedReview(source.id, 3))?.suggestions).toEqual([]);
});

test("merge retains spellings and descriptions, archives source history and rejects stale/replayed merges", async () => {
  const source = await term("MergeSource", "추가 정의", "원본 본문"), target = await term("MergeTarget", "대표 정의", "대표 본문");
  expect(await mergeTerms(source.id, target.id, 1, 1, null, null)).toEqual({ slug: target.slug });
  const merged = await getTermByIdOrSlug(target.id);
  expect(merged?.definitionMd).toBe("대표 정의");
  expect(merged?.bodyMd).toContain("원본 본문"); expect(merged?.bodyMd).toContain("추가 정의");
  expect(merged?.surfaces.map((s) => s.text)).toContain(source.nameEn);
  expect(await mergedDestination(source.id)).toBe(target.slug);
  expect(await currentRevisionNumber(source.id)).toBe(2);
  const [snapshot] = await getDb().select().from(termRevisions).where(eq(termRevisions.termId, source.id));
  expect(snapshot).toBeDefined();
  expect((await lookupTerms([source.nameEn!]))[0]?.terms.map((t) => t.id)).toEqual([target.id]);
  expect((await listPublishedTermRows({ q: source.nameEn!, page: 1, pageSize: 20, includeDraft: true })).items.map((t) => t.id)).not.toContain(source.id);
  await expect(mergeTerms(source.id, target.id, 1, 1, null, null)).rejects.toThrow();
  expect(await updateTerm(source.id, { definitionMd: "수정" }, null, 2)).toHaveProperty("invalid");
  const other = await term("OtherMerge");
  await expect(mergeTerms(other.id, target.id, 1, 1, null, null)).rejects.toThrow("변경");
  expect(await currentRevisionNumber(other.id)).toBe(1);
});

test("same-name domain-qualified slugs are included in duplicate candidates", async () => {
  const first = await term("Duplicate");
  const second = await term("Duplicate");
  expect(second.slug).toBe(`${first.slug}-qa`);
  expect((await duplicateCandidates({ id: second.id, slug: second.slug, nameEn: second.nameEn })).map((c) => c.id)).toContain(first.id);
});

// 동기화 가져오기는 replaced_by_id를 그대로 쓰므로 mergeTerms가 막는 상태도 DB에 생길 수 있다.
// 한 단계만 따라가면 상세 화면이 307을 끝없이 주고받는다(ERR_TOO_MANY_REDIRECTS).
test("merged destination follows chains and stops on cycles instead of redirecting forever", async () => {
  const a = await term("CycleA"), b = await term("CycleB"), c = await term("CycleC"), gone = await term("CycleGone");
  const point = (id: string, target: string | null) => getDb().update(terms).set({ replacedById: target }).where(eq(terms.id, id));

  await point(a.id, b.id); await point(b.id, c.id);
  expect(await mergedDestination(a.id)).toBe(c.slug);

  await point(c.id, a.id);
  expect(await mergedDestination(a.id)).toBeNull();
  expect(await mergedDestination(b.id)).toBeNull();

  await point(c.id, c.id);
  expect(await mergedDestination(c.id)).toBeNull();

  // 사슬 중간의 대상이 지워졌으면 B도 병합된 용어라 목적지가 될 수 없다.
  await point(c.id, null); await point(b.id, gone.id);
  await getDb().delete(terms).where(eq(terms.id, gone.id));
  expect(await mergedDestination(a.id)).toBeNull();
  expect(await mergedDestination(c.id)).toBeNull();
});

// replaced_by_id에는 FK가 없어 대표 용어만 지우면 원래 용어가 없는 id를 가리킨 채 남는다.
// 병합된 용어라 검색·목록에서 빠지고 편집도 거부돼, 어느 화면에서도 고칠 수 없게 된다.
test("deleting a merge target also deletes the terms merged into it, chains included", async () => {
  const { deleteTerm } = await import("../src/lib/terms/update");
  const target = await term("DeleteTarget"), source = await term("DeleteSource"), older = await term("DeleteOlder"), bystander = await term("DeleteBystander");
  await mergeTerms(source.id, target.id, 1, 1, null, null);
  await getDb().update(terms).set({ replacedById: source.id }).where(eq(terms.id, older.id));
  expect(await deleteTerm(target.id)).toBe(true);
  expect(await getDb().select({ id: terms.id }).from(terms).where(inArray(terms.id, [target.id, source.id, older.id]))).toEqual([]);
  expect(await getDb().select({ id: terms.id }).from(terms).where(eq(terms.id, bystander.id))).toHaveLength(1);
  expect(await deleteTerm(target.id)).toBe(false);
});

test("search and autocomplete do not list merged terms", async () => {
  const source = await term("SearchMergedSource"), target = await term("SearchMergedTarget");
  await mergeTerms(source.id, target.id, 1, 1, null, null);
  const { searchTerms, suggestTerms } = await import("../src/lib/terms/search");
  for (const hits of [await searchTerms(source.nameEn!), await suggestTerms(source.nameEn!)]) {
    expect(hits.map((hit) => hit.id)).toContain(target.id);
    expect(hits.map((hit) => hit.id)).not.toContain(source.id);
  }
});

test("withFullNames attaches each candidate's full names without dropping or reordering candidates", async () => {
  const { withFullNames } = await import("../src/lib/terms/lookup");
  const named = await term("FullNameHolder"), plain = await term("FullNamePlain");
  await getDb().update(terms).set({ fullNameEn: `Full Name Holder ${suffix}`, fullNameKo: "풀네임 보유" }).where(eq(terms.id, named.id));
  const rows = await withFullNames([{ id: plain.id, slug: plain.slug }, { id: named.id, slug: named.slug }]);
  expect(rows).toEqual([
    { id: plain.id, slug: plain.slug, fullNameEn: null, fullNameKo: null },
    { id: named.id, slug: named.slug, fullNameEn: `Full Name Holder ${suffix}`, fullNameKo: "풀네임 보유" },
  ]);
  expect(await withFullNames([])).toEqual([]);
});
