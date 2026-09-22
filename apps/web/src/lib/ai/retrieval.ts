import "server-only";

import { and, arrayContains, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { meetingDocuments, surfaceKeys, termRevisions, terms, termSurfaces, wikiPageTerms, wikiPages } from "@glossary/db";
import { approvedRelations } from "@/lib/terms/relations";
import { getDb } from "@/lib/db";
import { relevantPassages } from "./passages";
import { loadRagConfig } from "@/lib/rag/config";
import { searchRag, type RagSearchHit } from "@/lib/rag/search";
import { searchMeetingRag, type MeetingSearchHit } from "@/lib/rag/meeting-search";
import { searchWikiRag, type WikiSearchHit } from "@/lib/rag/wiki-search";
import type { AiRunContext } from "./observability-values";
import type { ChatEvidence, ChatOntologyPath } from "./grounding-values";
import { extractMarkdownImages } from "@/lib/markdown/images";
import { expandApprovedOntology, ontologyPathScore } from "@/lib/ontology/expand";
import { loadOntologyPredicates, predicateMap } from "@/lib/ontology/catalog";

export interface ChatSource {
  termId?: string;
  slug: string;
  title: string;
  definition: string | null;
  status: "draft" | "active";
  revision?: number;
  updatedAt?: string;
}

export interface ChatGrounding {
  context: string;
  sources: ChatSource[];
  evidence?: ChatEvidence[];
  ontology?: ChatOntologyPath[];
}

export interface RetrievalOptions {
  domain?: string;
  passageQuery?: string;
  vectorSearch?: boolean;
  includeMeetingDocuments?: boolean;
  includeWikiDocuments?: boolean;
  telemetry?: AiRunContext;
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

export async function retrieveGlossaryContext(question: string, limit = 12, options: RetrievalOptions = {}): Promise<ChatGrounding> {
  const vectorResults = options.vectorSearch ? await optionalVectorHits(question, options) : { glossaryHits: [], meetingHits: [], wikiHits: [] };
  return getDb().transaction((db) => retrieveSnapshot(db, question, limit, options, vectorResults.glossaryHits, vectorResults.meetingHits, vectorResults.wikiHits), { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function optionalVectorHits(question: string, options: RetrievalOptions): Promise<{ glossaryHits: RagSearchHit[]; meetingHits: MeetingSearchHit[]; wikiHits: WikiSearchHit[] }> {
  try {
    const config = await loadRagConfig();
    if (!config.enabled || !config.chatEnabled) return { glossaryHits: [], meetingHits: [], wikiHits: [] };
    const hasActiveMeetings = options.includeMeetingDocuments !== false
      && (await getDb().select({ id: meetingDocuments.id }).from(meetingDocuments).where(eq(meetingDocuments.status, "active")).limit(1)).length > 0;
    const hasPublishedWiki = options.includeWikiDocuments !== false
      && (await getDb().select({ id: wikiPages.id }).from(wikiPages).where(eq(wikiPages.status, "published")).limit(1)).length > 0;
    const topK = Math.min(24, Math.max(8, limitForVectorSearch(options)));
    const [glossaryResult, meetingResult, wikiResult] = await Promise.all([
      searchRag(question, {
        topK,
        domain: options.domain,
        rerank: config.rerankerEnabled,
        telemetry: options.telemetry,
      }).catch(() => [] as RagSearchHit[]),
      !hasActiveMeetings
        ? Promise.resolve([] as MeetingSearchHit[])
        : searchMeetingRag(question, {
          topK,
          domain: options.domain,
          rerank: config.rerankerEnabled,
          telemetry: options.telemetry,
        }).catch(() => [] as MeetingSearchHit[]),
      !hasPublishedWiki
        ? Promise.resolve([] as WikiSearchHit[])
        : searchWikiRag(question, {
          topK,
          domain: options.domain,
          rerank: config.rerankerEnabled,
          telemetry: options.telemetry,
        }).catch(() => [] as WikiSearchHit[]),
    ]);
    return { glossaryHits: glossaryResult, meetingHits: meetingResult, wikiHits: wikiResult };
  } catch {
    // The lexical path remains available when an optional vector provider is
    // unavailable. The failed provider call is still visible in AI telemetry.
    return { glossaryHits: [], meetingHits: [], wikiHits: [] };
  }
}

function limitForVectorSearch(options: RetrievalOptions): number {
  return options.vectorSearch ? 16 : 8;
}

function mergeWikiHits(hits: readonly WikiSearchHit[], limit: number): WikiSearchHit[] {
  const bestByPage = new Map<string, WikiSearchHit>();
  for (const hit of hits) {
    const key = `${hit.wikiPageId}:${hit.revision}`;
    const current = bestByPage.get(key);
    if (!current || hit.score > current.score) bestByPage.set(key, hit);
  }
  return [...bestByPage.values()]
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Math.min(24, limit)));
}

async function retrieveSnapshot(
  db: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  question: string,
  limit: number,
  options: RetrievalOptions,
  vectorHits: readonly RagSearchHit[] = [],
  meetingHits: readonly MeetingSearchHit[] = [],
  wikiHits: readonly WikiSearchHit[] = [],
): Promise<ChatGrounding> {
  const key = surfaceKeys(question).normLoose;
  const keywords = retrievalKeywords(question);
  const passageKeywords = retrievalKeywords(options.passageQuery ?? question);
  const wikiKeywords = [...new Set([...keywords, ...passageKeywords])];
  const domainFilter = and(sql`${terms.replacedById} is null`, options.domain ? arrayContains(terms.domain, [options.domain]) : undefined);
  if (!key && keywords.length === 0 && wikiKeywords.length === 0 && vectorHits.length === 0 && meetingHits.length === 0 && wikiHits.length === 0) return { context: "{\"terms\":[],\"relationships\":[],\"ontology\":[],\"meetings\":[],\"wiki\":[]}", sources: [], ontology: [] };

  const content = sql<string>`concat_ws(' ', ${terms.nameEn}, ${terms.nameKo}, ${terms.fullNameEn}, ${terms.fullNameKo}, ${terms.definitionMd}, ${terms.bodyMd})`;
  const wikiContent = sql<string>`concat_ws(' ', ${wikiPages.title}, ${wikiPages.summary}, ${wikiPages.content})`;
  const [surfaceCandidates, contentCandidates, wikiCandidates] = await Promise.all([
    key ? db
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
        domainFilter,
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
    keywords.length ? db
      .select({
        id: terms.id,
        score: sql<number>`(${sql.join(keywords.map((word) => sql`case when ${content} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})::int`,
      })
      .from(terms)
      .where(and(
        domainFilter,
        or(...keywords.map((word) => sql`${content} ilike ${`%${word}%`}`)),
      ))
      .orderBy(desc(sql`(${sql.join(keywords.map((word) => sql`case when ${content} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})`), desc(terms.updatedAt))
      .limit(40) : Promise.resolve([]),
    options.includeWikiDocuments === false || wikiKeywords.length === 0 ? Promise.resolve([]) : db
      .select({
        id: wikiPages.id,
        slug: wikiPages.slug,
        title: wikiPages.title,
        summary: wikiPages.summary,
        domain: wikiPages.domain,
        revision: wikiPages.revision,
        content: wikiPages.content,
        updatedAt: wikiPages.updatedAt,
        score: sql<number>`(${sql.join(wikiKeywords.map((word) => sql`case when ${wikiContent} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})::int`,
      })
      .from(wikiPages)
      .where(and(
        eq(wikiPages.status, "published"),
        options.domain ? arrayContains(wikiPages.domain, [options.domain]) : undefined,
        or(...wikiKeywords.map((word) => sql`${wikiContent} ilike ${`%${word}%`}`)),
      ))
      .orderBy(desc(sql`(${sql.join(wikiKeywords.map((word) => sql`case when ${wikiContent} ilike ${`%${word}%`} then 1 else 0 end`), sql` + `)})`), desc(wikiPages.updatedAt))
      .limit(Math.max(8, Math.min(24, limit * 2))),
  ]);

  const scores = new Map<string, number>();
  addRank(scores, surfaceCandidates.map((row) => row.id), 2);
  addRank(scores, contentCandidates.map((row) => row.id), 1);
  // RAG returns chunks, while the chat result is ranked by term. Count only
  // the best chunk per term so a long article cannot outrank shorter terms
  // merely because it produced more chunks.
  addRank(scores, [...new Set(vectorHits.map((row) => row.termId))], 1.5);
  const seedIds = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const linkedWikiRows = options.includeWikiDocuments === false || seedIds.length === 0 ? [] : await db
    .select({
      termId: wikiPageTerms.termId,
      termNameKo: terms.nameKo,
      termNameEn: terms.nameEn,
      pageId: wikiPages.id,
      slug: wikiPages.slug,
      title: wikiPages.title,
      summary: wikiPages.summary,
      domain: wikiPages.domain,
      revision: wikiPages.revision,
      content: wikiPages.content,
      updatedAt: wikiPages.updatedAt,
      role: wikiPageTerms.role,
    })
    .from(wikiPageTerms)
    .innerJoin(wikiPages, eq(wikiPages.id, wikiPageTerms.wikiPageId))
    .innerJoin(terms, eq(terms.id, wikiPageTerms.termId))
    .where(and(
      eq(wikiPages.status, "published"),
      options.domain ? arrayContains(wikiPages.domain, [options.domain]) : undefined,
      inArray(wikiPageTerms.termId, seedIds.slice(0, 12)),
    ))
    .orderBy(desc(wikiPages.updatedAt), asc(wikiPages.slug))
    .limit(Math.max(8, Math.min(24, limit * 2)));
  const meetingEvidence: ChatEvidence[] = meetingHits.map((hit) => ({
    id: `meeting:${hit.meetingDocumentId}:${hit.revision}:${hit.id}`,
    slug: `meeting:${hit.meetingDocumentId}`,
    title: hit.title,
    revision: hit.revision,
    updatedAt: hit.updatedAt,
    field: "meeting",
    excerpt: hit.content.slice(0, 1_800),
    start: hit.startOffset,
    source: "meeting",
    meetingDocumentId: hit.meetingDocumentId,
    meetingDate: hit.meetingDate,
  }));
  const lexicalWikiHits: WikiSearchHit[] = wikiCandidates.map((row) => ({
    id: `lexical:${row.id}:${row.revision}`,
    wikiPageId: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    domain: row.domain,
    revision: row.revision,
    content: row.content,
    startOffset: 0,
    endOffset: row.content.length,
    score: Math.min(1, Number(row.score) / Math.max(1, wikiKeywords.length)),
    rerankScore: null,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const linkedWikiHits: WikiSearchHit[] = linkedWikiRows.map((row) => ({
    id: `ontology:${row.pageId}:${row.termId}:${row.revision}`,
    wikiPageId: row.pageId,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    domain: row.domain,
    revision: row.revision,
    content: row.content,
    startOffset: 0,
    endOffset: row.content.length,
    score: row.role === "primary" ? 0.82 : 0.62,
    rerankScore: null,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const linkedWikiPaths: ChatOntologyPath[] = linkedWikiRows.map((row) => ({
    id: `wiki-link:${row.pageId}:${row.termId}:${row.role}`,
    source: { kind: "wiki_page" as const, id: row.pageId, title: row.title },
    predicateKey: row.role === "primary" ? "defines" : "applies_to",
    target: { kind: "term" as const, id: row.termId, title: displayName({ nameKo: row.termNameKo, nameEn: row.termNameEn }) },
    depth: 1,
    confidence: row.role === "primary" ? 100 : 80,
    evidence: `위키 문서의 ${row.role === "primary" ? "주요" : "관련"} 용어 연결`,
  }));
  const combinedWikiHits = mergeWikiHits([...wikiHits, ...lexicalWikiHits, ...linkedWikiHits], limit);
  const wikiPageIds = [...new Set(combinedWikiHits.map((hit) => hit.wikiPageId))];
  const wikiImageRows = wikiPageIds.length
    ? await db.select({ id: wikiPages.id, content: wikiPages.content }).from(wikiPages).where(inArray(wikiPages.id, wikiPageIds))
    : [];
  const wikiImages = new Map(wikiImageRows.map((row) => [row.id, extractMarkdownImages(row.content)]));
  const wikiEvidence: ChatEvidence[] = combinedWikiHits.map((hit) => ({
    id: `wiki:${hit.wikiPageId}:${hit.revision}:${hit.id}`,
    slug: hit.slug,
    title: hit.title,
    revision: hit.revision,
    updatedAt: hit.updatedAt,
    field: "wiki",
    excerpt: hit.content.slice(0, 1_800),
    images: wikiImages.get(hit.wikiPageId) ?? extractMarkdownImages(hit.content),
    start: hit.startOffset,
    source: "wiki",
    wikiPageId: hit.wikiPageId,
    wikiSlug: hit.slug,
  }));
  const meetingEntries = meetingHits.map((hit) => ({
    id: hit.meetingDocumentId,
    title: hit.title,
    meetingDate: hit.meetingDate,
    source: hit.source,
    team: hit.team,
    domain: hit.domain,
    revision: hit.revision,
    excerpt: hit.content.slice(0, 1_800),
  }));
  const wikiEntries = combinedWikiHits.map((hit) => ({
    id: hit.wikiPageId,
    slug: hit.slug,
    title: hit.title,
    summary: hit.summary,
    domain: hit.domain,
    revision: hit.revision,
    excerpt: hit.content.slice(0, 1_800),
    images: wikiImages.get(hit.wikiPageId) ?? extractMarkdownImages(hit.content),
  }));
  if (seedIds.length === 0) return {
    context: JSON.stringify({ terms: [], relationships: [], ontology: linkedWikiPaths, meetings: meetingEntries, wiki: wikiEntries }),
    sources: [],
    evidence: [...meetingEvidence, ...wikiEvidence],
    ontology: linkedWikiPaths,
  };

  const graphSeeds = seedIds.slice(0, 6);
  const ontologyPredicates = await loadOntologyPredicates(db);
  const ontologyCatalog = predicateMap(ontologyPredicates);
  const ontologyExpansion = await expandApprovedOntology(db, graphSeeds, ontologyPredicates, { maxDepth: 2, limit: 80, domain: options.domain });
  for (const path of ontologyExpansion.paths) {
    scores.set(path.targetTermId, (scores.get(path.targetTermId) ?? 0) + ontologyPathScore(path));
  }
  const relationshipRows = ontologyExpansion.relations;
  const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

  const [termRows, surfaceRows] = await Promise.all([
    db.select({
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
      updatedAt: terms.updatedAt,
      // Keep the outer id qualified: the revisions table also has an id column.
      revision: sql<number>`(select coalesce(max(${termRevisions.revisionNumber}), 0)::int from ${termRevisions} where ${termRevisions.termId} = "terms"."id")`,
    }).from(terms).where(and(inArray(terms.id, ids), domainFilter)),
    db.select({ termId: termSurfaces.termId, text: termSurfaces.text, kind: termSurfaces.kind })
      .from(termSurfaces).where(inArray(termSurfaces.termId, ids)),
  ]);
  const order = new Map(ids.map((id, index) => [id, index]));
  termRows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const includedIds = new Set(termRows.map((term) => term.id));
  const names = new Map(termRows.map((term) => [term.id, displayName(term)]));
  const byId = new Map(termRows.map((term) => [term.id, term]));
  const ontologyPaths: ChatOntologyPath[] = [
    ...ontologyExpansion.paths.filter((path) => includedIds.has(path.sourceTermId) && includedIds.has(path.targetTermId)).map((path) => ({
      id: path.id,
      source: { kind: "term" as const, id: path.sourceTermId, title: names.get(path.sourceTermId) ?? path.sourceTermId },
      predicateKey: path.predicateKey,
      predicateLabel: ontologyCatalog.get(path.predicateKey)?.label ?? path.predicateKey,
      target: { kind: "term" as const, id: path.targetTermId, title: names.get(path.targetTermId) ?? path.targetTermId },
      depth: path.depth,
      confidence: path.confidence,
      evidence: path.evidenceMd,
    })),
    ...linkedWikiPaths,
  ];
  const evidence: ChatEvidence[] = termRows.flatMap((term) => {
    const base = { termId: term.id, slug: term.slug, title: displayName(term), revision: term.revision, updatedAt: term.updatedAt.toISOString() };
    const images = {
      definition: extractMarkdownImages(term.definitionMd),
      body: extractMarkdownImages(term.bodyMd),
    };
    const allImages = [...new Map([...images.definition, ...images.body].map((image) => [image.url, image])).values()];
    const metadata = `표기: ${[term.nameKo, term.nameEn].filter(Boolean).join(" / ")}; 확장명: ${[term.fullNameKo, term.fullNameEn].filter(Boolean).join(" / ")}; 도메인: ${term.domain.join(", ")}; 업무 분류: ${term.categories.join(", ")}; 주제: ${term.topic ?? ""}; 추가 표기: ${surfaceRows.filter((surface) => surface.termId === term.id).map((surface) => `${surface.text} (${surface.kind})`).join(", ")}`;
    const vectorEvidence = vectorHits
      .filter((hit) => hit.termId === term.id && hit.revision === term.revision)
      .map((hit) => ({
        ...base,
        id: `${term.id}:${term.revision}:vector:${hit.id}`,
        field: hit.sourceField as ChatEvidence["field"],
        excerpt: hit.content.slice(0, 1_800),
        images: hit.sourceField === "body" || hit.sourceField === "definition" ? images[hit.sourceField] : hit.sourceField === "metadata" ? allImages : undefined,
      }));
    return [
      { ...base, id: `${term.id}:${term.revision}:metadata`, field: "metadata" as const, excerpt: metadata.slice(0, 1800), images: allImages },
      ...(["definition", "body"] as const).flatMap((field) => relevantPassages(field === "body" ? term.bodyMd : term.definitionMd, passageKeywords, field === "body" ? 3 : 1)
        .map((passage) => ({ ...base, id: `${term.id}:${term.revision}:${field}:${passage.start}`, field, excerpt: passage.text, images: images[field], start: passage.start }))),
      ...vectorEvidence,
    ];
  });

  const entries = termRows.map((term) => ({
    id: term.id,
    slug: term.slug,
    canonical: { ko: term.nameKo, en: term.nameEn },
    fullName: { ko: term.fullNameKo, en: term.fullNameEn },
    status: term.status,
    domains: term.domain,
    businessCategories: term.categories,
    topic: term.topic,
    definition: evidence.filter((item) => item.slug === term.slug && item.field === "definition").map((item) => item.excerpt).join("\n\n") || null,
    body: evidence.filter((item) => item.slug === term.slug && item.field === "body").map((item) => item.excerpt).join("\n\n") || null,
    images: {
      definition: extractMarkdownImages(term.definitionMd),
      body: extractMarkdownImages(term.bodyMd),
    },
    revision: term.revision,
    updatedAt: term.updatedAt.toISOString(),
    replacedById: term.replacedById,
    surfaces: surfaceRows.filter((surface) => surface.termId === term.id).map(({ text, kind }) => ({ text, kind })),
  }));
  const relationships = relationshipRows
    .filter((relation) => includedIds.has(relation.sourceTermId) && includedIds.has(relation.targetTermId))
    .filter((relation) => (relation.sourceRevision === null || relation.sourceRevision === byId.get(relation.sourceTermId)?.revision)
      && (relation.targetRevision === null || relation.targetRevision === byId.get(relation.targetTermId)?.revision))
    .map((relation) => {
      const source = byId.get(relation.sourceTermId)!;
      const target = byId.get(relation.targetTermId)!;
      evidence.push({ id: `relation:${relation.id}:${source.revision}:${target.revision}`, termId: source.id, slug: source.slug, title: displayName(source), revision: source.revision,
        updatedAt: source.updatedAt.toISOString(), field: "relationship", excerpt: `${displayName(source)} → ${relation.relationType} → ${displayName(target)}\n${relation.evidenceMd ?? ""}`.slice(0, 1800),
        relatedTerm: { termId: target.id, slug: target.slug, title: displayName(target), revision: target.revision } });
      return {
        source: { id: relation.sourceTermId, name: names.get(relation.sourceTermId) },
        target: { id: relation.targetTermId, name: names.get(relation.targetTermId) },
        type: relation.relationType,
        confidence: relation.confidence,
        evidence: relation.evidenceMd,
      };
    });

  return {
    context: JSON.stringify({ terms: entries, relationships, ontology: ontologyPaths, meetings: meetingEntries, wiki: wikiEntries }),
    evidence: [...evidence, ...meetingEvidence, ...wikiEvidence],
    ontology: ontologyPaths,
    sources: termRows.map((term) => ({
      termId: term.id,
      slug: term.slug,
      title: displayName(term),
      definition: term.definitionMd,
      status: term.status as ChatSource["status"],
      revision: term.revision,
      updatedAt: term.updatedAt.toISOString(),
    })),
  };
}
