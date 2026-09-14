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

test("same-name numbered slugs are included in duplicate candidates", async () => {
  const first = await term("Duplicate");
  const second = await term("Duplicate");
  expect(second.slug).toMatch(/-2$/);
  expect((await duplicateCandidates({ id: second.id, slug: second.slug, nameEn: second.nameEn })).map((c) => c.id)).toContain(first.id);
});
