import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, termRelations, terms } from "@glossary/db";
import { retrieveGlossaryContext, retrievalKeywords } from "../src/lib/ai/retrieval.js";
import { createTerm } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
let activeSlug = "";
let draftSlug = "";
let relatedSlug = "";
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const activeName = `ZQ${suffix}`;
const draftName = `DR${suffix}`;

beforeAll(async () => {
  const active = await createTerm({
    nameEn: activeName,
    fullNameEn: "Zero Query Retrieval Probe",
    definitionMd: "용어 챗봇 검색 회귀 테스트를 위한 공개 용어",
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
  await db.insert(termRelations).values({
    sourceTermId: active.term.id,
    targetTermId: related.term.id,
    relationType: "used_in",
    status: "approved",
    evidenceMd: "검색 그래프 확장 테스트",
  });
  ids.push(active.term.id, draft.term.id, related.term.id);
  activeSlug = active.term.slug;
  draftSlug = draft.term.slug;
  relatedSlug = related.term.slug;
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
});

test("초안 용어는 검색 근거와 출처에서 제외한다", async () => {
  const result = await retrieveGlossaryContext(`${draftName}가 무엇인지 알려 줘`);
  expect(result.sources.map((source) => source.slug)).not.toContain(draftSlug);
  expect(result.context).not.toContain("외부 AI로 전달되면 안 되는 초안");
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

test("검색어 추출은 불용어·중복을 제거하고 길이를 제한한다", () => {
  expect(retrievalKeywords("MTO에 대해 설명해 줘. MTO 생산 방식")).toEqual(["mto", "생산", "방식"]);
  expect(retrievalKeywords("가 나 다 라 마 바 사 아 자 차 카 타 파 하 extra words")).toHaveLength(2);
});
