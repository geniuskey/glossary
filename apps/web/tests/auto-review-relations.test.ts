import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { aiReviewQueue, aiReviewSuggestions, createDb, termRelations, terms } from "@glossary/db";
import { decidePreparedRelationSuggestion, getPreparedReview, listReviewQueue, reviewQueueStatuses } from "../src/lib/ai/auto-review.js";
import { createTerm } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
let sourceId = "";
let relationId = "";
const suffix = Date.now().toString(36).slice(-6).toUpperCase();

beforeAll(async () => {
  const source = await createTerm({
    nameEn: `RelationReviewSource${suffix}`,
    definitionMd: "관계 검토 테스트의 출발 용어",
    domain: ["QA"],
    status: "draft",
    surfaces: [],
  }, null);
  const target = await createTerm({
    nameEn: `RelationReviewTarget${suffix}`,
    definitionMd: "관계 검토 테스트의 대상 용어",
    domain: ["QA"],
    status: "active",
    surfaces: [],
  }, null);
  ids.push(source.term.id, target.term.id);
  sourceId = source.term.id;

  const [relation] = await db.insert(termRelations).values({
    sourceTermId: source.term.id,
    targetTermId: target.term.id,
    relationType: "used_in",
    status: "proposed",
    confidence: 88,
    evidenceMd: "승인 상태 전환 테스트",
    sourceRevision: 1,
    targetRevision: 1,
  }).returning({ id: termRelations.id });
  relationId = relation!.id;

  await db.insert(aiReviewSuggestions).values({
    termId: source.term.id,
    revision: 1,
    generatorVersion: 2,
    suggestions: [{
      id: `relation-${relationId}`,
      field: "relation",
      value: {
        relationId,
        targetTermId: target.term.id,
        targetSlug: target.term.slug,
        targetName: target.term.nameEn,
        relationType: "used_in",
        confidence: 88,
      },
      reason: "승인 상태 전환 테스트",
      source: "agent",
    }],
  });
  await db.insert(aiReviewQueue).values({
    termId: source.term.id,
    revision: 1,
    status: "ready",
    requestMode: "manual",
  });
});

test("검토 큐는 모든 사용자가 볼 수 있는 상태 집계와 용어 정보를 제공한다", async () => {
  const queue = await listReviewQueue();
  expect(queue.counts.total).toBeGreaterThanOrEqual(1);
  expect(queue.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ termId: sourceId, status: "ready", requestMode: "manual" }),
  ]));
  await expect(reviewQueueStatuses([{ id: sourceId, revision: 1 }])).resolves.toEqual({ [sourceId]: "ready" });
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("관계 제안을 승인하면 관계 상태를 바꾸고 검토 목록에서 제거한다", async () => {
  const decided = await decidePreparedRelationSuggestion({
    termId: sourceId,
    revision: 1,
    suggestionId: `relation-${relationId}`,
    decision: "approved",
    reviewedBy: null,
  });

  expect(decided).toBe(true);
  const [relation] = await db.select().from(termRelations).where(eq(termRelations.id, relationId));
  expect(relation).toMatchObject({ status: "approved", confidence: 88 });
  expect(relation?.reviewedAt).toBeInstanceOf(Date);
  expect((await getPreparedReview(sourceId, 1))?.suggestions).toEqual([]);
});

test("이미 처리된 관계 제안은 다시 승인할 수 없다", async () => {
  await expect(decidePreparedRelationSuggestion({
    termId: sourceId,
    revision: 1,
    suggestionId: `relation-${relationId}`,
    decision: "approved",
    reviewedBy: null,
  })).resolves.toBe(false);
});
