import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, termRelations, terms } from "@glossary/db";
import { retrieveGlossaryContext, retrievalKeywords } from "../src/lib/ai/retrieval.js";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";
import { expandApprovedOntology } from "../src/lib/ontology/expand.js";
import { loadOntologyPredicates } from "../src/lib/ontology/catalog.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
let activeSlug = "";
let activeId = "";
let relatedId = "";
let transitiveId = "";
let draftSlug = "";
let relatedSlug = "";
let transitiveSlug = "";
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const activeName = `ZQ${suffix}`;
const draftName = `DR${suffix}`;

beforeAll(async () => {
  const active = await createTerm({
    nameEn: activeName,
    fullNameEn: "Zero Query Retrieval Probe",
    definitionMd: `용어 챗봇 검색 회귀 테스트를 위한 공개 용어\n![용어 도표](/api/v1/attachments/${"d".repeat(64)})`,
    domain: ["QA"],
    status: "active",
    surfaces: [],
  }, null);
  const draft = await createTerm({
    nameEn: draftName,
    definitionMd: "외부 AI로 전달되면 안 되는 초안",
    domain: ["QA"],
    status: "draft",
    surfaces: [],
  }, null);
  const related = await createTerm({
    nameEn: `REL${suffix}`,
    definitionMd: "그래프 검색 회귀 테스트를 위한 인접 공개 용어",
    domain: ["QA"],
    status: "active",
    surfaces: [],
  }, null);
  const transitive = await createTerm({
    nameEn: `TRANS${suffix}`,
    definitionMd: "그래프 2-hop 확장 회귀 테스트를 위한 공개 용어",
    domain: ["QA"],
    status: "active",
    surfaces: [],
  }, null);
  await db.insert(termRelations).values({
    sourceTermId: active.term.id,
    targetTermId: related.term.id,
    relationType: "used_in",
    status: "approved",
    evidenceMd: "검색 그래프 확장 테스트",
  });
  await db.insert(termRelations).values({
    sourceTermId: related.term.id,
    targetTermId: transitive.term.id,
    relationType: "is_a",
    status: "approved",
    evidenceMd: "2-hop 온톨로지 경로 테스트",
  });
  ids.push(active.term.id, draft.term.id, related.term.id, transitive.term.id);
  activeSlug = active.term.slug;
  activeId = active.term.id;
  draftSlug = draft.term.slug;
  relatedSlug = related.term.slug;
  relatedId = related.term.id;
  transitiveId = transitive.term.id;
  transitiveSlug = transitive.term.slug;
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("질문 문장 안의 짧은 약어를 찾아 AI 근거와 출처를 만든다", async () => {
  const result = await retrieveGlossaryContext(`${activeName}의 사내 의미를 설명해 줘`);
  expect(result.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ slug: activeSlug, title: activeName, status: "active" }),
  ]));
  expect(result.context).toContain("Zero Query Retrieval Probe");
  expect(result.context).toContain("용어 챗봇 검색 회귀 테스트");
  expect(result.evidence?.flatMap((item) => item.images ?? [])).toContainEqual({
    url: `/api/v1/attachments/${"d".repeat(64)}`,
    alt: "용어 도표",
  });
});

test("보완 필요 용어도 검색 근거와 출처로 활용한다", async () => {
  const result = await retrieveGlossaryContext(`${draftName}가 무엇인지 알려 줘`);
  expect(result.sources.map((source) => source.slug)).toContain(draftSlug);
  expect(result.context).toContain("외부 AI로 전달되면 안 되는 초안");
});

test("표기명이 없는 자연어 질문도 정의 내용으로 검색한다", async () => {
  const result = await retrieveGlossaryContext("검색 회귀 테스트에 쓰이는 공개 항목");
  expect(result.sources.map((source) => source.slug)).toContain(activeSlug);
});

test("승인된 관계는 seed 용어의 1-hop 검색 근거를 확장한다", async () => {
  const result = await retrieveGlossaryContext(`${activeName}의 연결 대상을 알려 줘`);
  expect(result.sources.map((source) => source.slug)).toContain(relatedSlug);
  expect(result.context).toContain('"type":"used_in"');
  expect(result.context).toContain("검색 그래프 확장 테스트");
});

test("승인된 관계를 최대 2-hop 온톨로지 경로로 확장한다", async () => {
  const result = await retrieveGlossaryContext(activeName);
  expect(result.sources.map((source) => source.slug)).toContain(transitiveSlug);
  const expansion = await expandApprovedOntology(db, [activeId], await loadOntologyPredicates(db), { maxDepth: 2 });
  expect(expansion.paths).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceTermId: relatedId,
      targetTermId: transitiveId,
      depth: 2,
    }),
  ]));
  expect(result.context).toContain('"ontology"');
});

test("검색어 추출은 불용어·중복을 제거하고 길이를 제한한다", () => {
  expect(retrievalKeywords("MTO에 대해 설명해 줘. MTO 생산 방식")).toEqual(["mto", "생산", "방식"]);
  expect(retrievalKeywords("가 나 다 라 마 바 사 아 자 차 카 타 파 하 extra words")).toHaveLength(2);
});

test("도메인 범위를 벗어난 용어와 관계 근거는 전달하지 않는다", async () => {
  const result = await retrieveGlossaryContext(activeName, 12, { domain: "존재하지않는도메인" });
  expect(result.sources).toHaveLength(0);
  expect(result.evidence ?? []).toHaveLength(0);
  const scoped = await retrieveGlossaryContext(activeName, 12, { domain: "QA" });
  expect(scoped.sources.map((source) => source.slug)).toContain(activeSlug);
  const outside = await createTerm({ nameEn: `Outside${suffix}`, domain: ["다른도메인"], surfaces: [] }, null);
  ids.push(outside.term.id);
  await db.insert(termRelations).values({ sourceTermId: ids[0]!, targetTermId: outside.term.id, relationType: "used_in", status: "approved", evidenceMd: "도메인 밖 연결" });
  const withNeighbor = await retrieveGlossaryContext(activeName, 12, { domain: "QA" });
  expect(withNeighbor.sources.map((source) => source.slug)).not.toContain(outside.term.slug);
  expect(withNeighbor.context).not.toContain("도메인 밖 연결");
  expect(withNeighbor.evidence?.some((item) => item.slug === outside.term.slug)).toBe(false);
});

test("본문 뒤쪽 근거를 찾아 리비전을 기록하고 수정 뒤에도 기존 구절이 보존된다", async () => {
  const { term } = await createTerm({ nameEn: `Long${suffix}`, domain: ["QA"], surfaces: [], bodyMd: `${"일반 안내\n\n".repeat(700)}해외 정산 예외는 3영업일 후 처리한다.` }, null);
  ids.push(term.id);
  const result = await retrieveGlossaryContext(term.nameEn!, 12, { passageQuery: "해외 정산 예외 처리" });
  const saved = result.evidence?.find((item) => item.slug === term.slug && item.excerpt.includes("3영업일"));
  expect(saved?.revision).toBe(1);
  expect(saved?.start).toBeGreaterThan(3000);
  expect(result.context).toContain("3영업일");
  await updateTerm(term.id, { bodyMd: "해외 정산 예외는 5영업일 후 처리한다." }, null, 1);
  const latest = await retrieveGlossaryContext(term.nameEn!);
  expect(latest.sources.find((item) => item.slug === term.slug)?.revision).toBe(2);
  expect(saved?.excerpt).toContain("3영업일");
});

test("승인 당시 리비전이 지난 관계를 현재 사실로 전달하지 않는다", async () => {
  const a = await createTerm({ nameEn: `OldRel${suffix}`, domain: ["QA"], surfaces: [] }, null);
  const b = await createTerm({ nameEn: `NextRel${suffix}`, domain: ["QA"], surfaces: [] }, null);
  ids.push(a.term.id, b.term.id);
  await db.insert(termRelations).values({ sourceTermId: a.term.id, targetTermId: b.term.id, relationType: "used_in", status: "approved", sourceRevision: 1, targetRevision: 1, evidenceMd: "이전 관계 근거" });
  expect((await retrieveGlossaryContext(a.term.nameEn!)).evidence?.some((item) => item.field === "relationship" && item.excerpt.includes("이전 관계 근거"))).toBe(true);
  await updateTerm(b.term.id, { definitionMd: "용도 변경" }, null, 1);
  const result = await retrieveGlossaryContext(a.term.nameEn!);
  expect(result.context).not.toContain("이전 관계 근거");
  expect(result.evidence?.some((item) => item.excerpt.includes("이전 관계 근거"))).toBe(false);
});
