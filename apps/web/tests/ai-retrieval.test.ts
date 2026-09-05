import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms } from "@glossary/db";
import { retrieveGlossaryContext } from "../src/lib/ai/retrieval.js";
import { createTerm } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];
let activeSlug = "";
let draftSlug = "";
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const activeName = `ZQ${suffix}`;
const draftName = `DR${suffix}`;

beforeAll(async () => {
  const active = await createTerm({
    termType: "concept",
    nameEn: activeName,
    fullNameEn: "Zero Query Retrieval Probe",
    definitionMd: "용어 챗봇 검색 회귀 테스트를 위한 공개 용어",
    domain: ["QA"],
    status: "active",
    surfaces: [],
  }, null);
  const draft = await createTerm({
    termType: "concept",
    nameEn: draftName,
    definitionMd: "외부 AI로 전달되면 안 되는 초안",
    domain: ["QA"],
    status: "draft",
    surfaces: [],
  }, null);
  ids.push(active.term.id, draft.term.id);
  activeSlug = active.term.slug;
  draftSlug = draft.term.slug;
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
