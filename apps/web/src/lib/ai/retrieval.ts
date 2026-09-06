import "server-only";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { surfaceKeys, termRelations, terms, termSurfaces } from "@glossary/db";
import { getDb } from "@/lib/db";

export interface ChatSource {
  slug: string;
  title: string;
  definition: string | null;
  status: "draft" | "active";
}

export interface ChatGrounding {
  context: string;
  sources: ChatSource[];
}

const STOP_WORDS = new Set([
  "대해", "대한", "무엇", "뭐야", "알려", "설명", "설명해", "어떤", "관련", "용어", "에서", "으로", "하는", "줘", "the", "what", "about", "explain",
]);

function displayName(term: { nameKo: string | null; nameEn: string | null }): string {
  return term.nameKo || term.nameEn || "이름 없는 용어";
}

/** 표기가 직접 등장하지 않는 자연어 질문도 정의·본문에서 찾을 수 있게 검색어만 추린다. */
export function retrievalKeywords(question: string): string[] {
  const words = question.normalize("NFKC").match(/[0-9A-Za-z가-힣][0-9A-Za-z가-힣+./-]*/g) ?? [];
  return [...new Set(words
    .map((word) => word.toLowerCase().replace(/[+./-]+$/g, ""))
    .map((word) => word.replace(/(?:으로|에서|에게|은|는|이|가|을|를|에|의|와|과|로)$/u, ""))
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function addRank(scores: Map<string, number>, ids: readonly string[], weight: number): void {
  ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + weight / (60 + rank + 1)));
}

export async function retrieveGlossaryContext(question: string, limit = 12): Promise<ChatGrounding> {
  const key = surfaceKeys(question).normLoose;
  const keywords = retrievalKeywords(question);
  if (!key && keywords.length === 0) return { context: "{\"terms\":[],\"relationships\":[]}", sources: [] };

  const content = sql<string>`concat_ws(' ', ${terms.nameEn}, ${terms.nameKo}, ${terms.fullNameEn}, ${terms.fullNameKo}, ${terms.definitionMd}, ${terms.bodyMd})`;
  const [surfaceCandidates, contentCandidates] = await Promise.all([
    key ? getDb()
      .select({
        id: terms.id,
        score: sql<number>`max(
          case when ${termSurfaces.normLoose} = ${key} then 100
               when char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0 then 80 + least(char_length(${termSurfaces.normLoose}), 20)
               when position(${key} in ${termSurfaces.normLoose}) > 0 then 60
               else similarity(${termSurfaces.normLoose}, ${key}) * 40 end
        )`,
      })
      .from(termSurfaces)
      .innerJoin(terms, eq(terms.id, termSurfaces.termId))
      .where(and(
        sql`(
          (${termSurfaces.normLoose} = ${key})
          or (char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0)
          or (position(${key} in ${termSurfaces.normLoose}) > 0)
          or similarity(${termSurfaces.normLoose}, ${key}) >= 0.22
        )`,
      ))
      .groupBy(terms.id)
      .orderBy(desc(sql`max(
        case when ${termSurfaces.normLoose} = ${key} then 100
             when char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0 then 80 + least(char_length(${termSurfaces.normLoose}), 20)
             when position(${key} in ${termSurfaces.normLoose}) > 0 then 60
             else similarity(${termSurfaces.normLoose}, ${key}) * 40 end
      )`))
      .limit(40) : Promise.resolve([]),
    keywords.length ? getDb()
      .select({
        id: terms.id,
        score: sql<number>`(${sql.join(keywords.map((word) => sql`case when ${content} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})::int`,
      })
      .from(terms)
      .where(and(
        or(...keywords.map((word) => sql`${content} ilike ${`%${word}%`}`)),
      ))
      .orderBy(desc(sql`(${sql.join(keywords.map((word) => sql`case when ${content} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})`), desc(terms.updatedAt))
      .limit(40) : Promise.resolve([]),
  ]);

  const scores = new Map<string, number>();
  addRank(scores, surfaceCandidates.map((row) => row.id), 2);
  addRank(scores, contentCandidates.map((row) => row.id), 1);
  const seedIds = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (seedIds.length === 0) return { context: "{\"terms\":[],\"relationships\":[]}", sources: [] };

  const graphSeeds = seedIds.slice(0, 6);
  const relationshipRows = await getDb().select({
    sourceTermId: termRelations.sourceTermId,
    targetTermId: termRelations.targetTermId,
    relationType: termRelations.relationType,
    confidence: termRelations.confidence,
    evidenceMd: termRelations.evidenceMd,
  }).from(termRelations).where(and(
    eq(termRelations.status, "approved"),
    or(inArray(termRelations.sourceTermId, graphSeeds), inArray(termRelations.targetTermId, graphSeeds)),
  )).limit(40);

  const seedSet = new Set(seedIds);
  for (const relation of relationshipRows) {
    const neighbor = seedSet.has(relation.sourceTermId) ? relation.targetTermId : relation.sourceTermId;
    scores.set(neighbor, (scores.get(neighbor) ?? 0) + (0.5 * relation.confidence / 100) / 61);
  }
  const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

  const [termRows, surfaceRows] = await Promise.all([
    getDb().select({
      id: terms.id,
      slug: terms.slug,
      nameEn: terms.nameEn,
      nameKo: terms.nameKo,
      fullNameEn: terms.fullNameEn,
      fullNameKo: terms.fullNameKo,
      domain: terms.domain,
      categories: terms.category,
      topic: terms.topic,
      status: terms.status,
      definitionMd: terms.definitionMd,
      bodyMd: terms.bodyMd,
      replacedById: terms.replacedById,
    }).from(terms).where(inArray(terms.id, ids)),
    getDb().select({ termId: termSurfaces.termId, text: termSurfaces.text, kind: termSurfaces.kind })
      .from(termSurfaces).where(inArray(termSurfaces.termId, ids)),
  ]);
  const order = new Map(ids.map((id, index) => [id, index]));
  termRows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const includedIds = new Set(termRows.map((term) => term.id));
  const names = new Map(termRows.map((term) => [term.id, displayName(term)]));

  const entries = termRows.map((term) => ({
    id: term.id,
    slug: term.slug,
    canonical: { ko: term.nameKo, en: term.nameEn },
    fullName: { ko: term.fullNameKo, en: term.fullNameEn },
    status: term.status,
    domains: term.domain,
    businessCategories: term.categories,
    topic: term.topic,
    definition: term.definitionMd,
    body: term.bodyMd?.slice(0, 3_000) ?? null,
    replacedById: term.replacedById,
    surfaces: surfaceRows.filter((surface) => surface.termId === term.id).map(({ text, kind }) => ({ text, kind })),
  }));
  const relationships = relationshipRows
    .filter((relation) => includedIds.has(relation.sourceTermId) && includedIds.has(relation.targetTermId))
    .map((relation) => ({
      source: { id: relation.sourceTermId, name: names.get(relation.sourceTermId) },
      target: { id: relation.targetTermId, name: names.get(relation.targetTermId) },
      type: relation.relationType,
      confidence: relation.confidence,
      evidence: relation.evidenceMd,
    }));

  return {
    context: JSON.stringify({ terms: entries, relationships }),
    sources: termRows.map((term) => ({
      slug: term.slug,
      title: displayName(term),
      definition: term.definitionMd,
      status: term.status as ChatSource["status"],
    })),
  };
}
