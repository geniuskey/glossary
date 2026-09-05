import "server-only";

import { and, desc, inArray, ne, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces } from "@glossary/db";
import { getDb } from "@/lib/db";

export interface ChatSource {
  slug: string;
  title: string;
  definition: string | null;
  status: "active" | "deprecated" | "forbidden";
}

export interface ChatGrounding {
  context: string;
  sources: ChatSource[];
}

function displayName(term: { nameKo: string | null; nameEn: string | null }): string {
  return term.nameKo || term.nameEn || "이름 없는 용어";
}

export async function retrieveGlossaryContext(question: string, limit = 12): Promise<ChatGrounding> {
  const key = surfaceKeys(question).normLoose;
  if (!key) return { context: "[]", sources: [] };

  const candidates = await getDb()
    .select({
      id: terms.id,
      score: sql<number>`(
        case when ${termSurfaces.normLoose} = ${key} then 100
             when char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0 then 80 + least(char_length(${termSurfaces.normLoose}), 20)
             when position(${key} in ${termSurfaces.normLoose}) > 0 then 60
             else similarity(${termSurfaces.normLoose}, ${key}) * 40 end
      )`,
    })
    .from(termSurfaces)
    .innerJoin(terms, sql`${terms.id} = ${termSurfaces.termId}`)
    .where(and(
      ne(terms.status, "draft"),
      sql`(
        (${termSurfaces.normLoose} = ${key})
        or (char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0)
        or (position(${key} in ${termSurfaces.normLoose}) > 0)
        or similarity(${termSurfaces.normLoose}, ${key}) >= 0.22
      )`,
    ))
    .orderBy(desc(sql`(
      case when ${termSurfaces.normLoose} = ${key} then 100
           when char_length(${termSurfaces.normLoose}) >= 2 and position(${termSurfaces.normLoose} in ${key}) > 0 then 80 + least(char_length(${termSurfaces.normLoose}), 20)
           when position(${key} in ${termSurfaces.normLoose}) > 0 then 60
           else similarity(${termSurfaces.normLoose}, ${key}) * 40 end
    )`))
    .limit(80);

  const ids: string[] = [];
  for (const candidate of candidates) {
    if (!ids.includes(candidate.id)) ids.push(candidate.id);
    if (ids.length >= limit) break;
  }
  if (ids.length === 0) return { context: "[]", sources: [] };

  const [termRows, surfaceRows] = await Promise.all([
    getDb().select({
      id: terms.id,
      slug: terms.slug,
      nameEn: terms.nameEn,
      nameKo: terms.nameKo,
      fullNameEn: terms.fullNameEn,
      fullNameKo: terms.fullNameKo,
      termType: terms.termType,
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

  const entries = termRows.map((term) => ({
    slug: term.slug,
    canonical: { ko: term.nameKo, en: term.nameEn },
    fullName: { ko: term.fullNameKo, en: term.fullNameEn },
    type: term.termType,
    status: term.status,
    domains: term.domain,
    businessCategories: term.categories,
    topic: term.topic,
    definition: term.definitionMd,
    body: term.bodyMd?.slice(0, 3_000) ?? null,
    replacedById: term.replacedById,
    surfaces: surfaceRows.filter((surface) => surface.termId === term.id).map(({ text, kind }) => ({ text, kind })),
  }));

  return {
    context: JSON.stringify(entries),
    sources: termRows.map((term) => ({
      slug: term.slug,
      title: displayName(term),
      definition: term.definitionMd,
      status: term.status as ChatSource["status"],
    })),
  };
}
