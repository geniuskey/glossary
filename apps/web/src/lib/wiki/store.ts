import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, or, sql, type InferSelectModel } from "drizzle-orm";
import { terms, wikiPageRevisions, wikiPages, wikiPageTerms, wikiPageStatusEnum } from "@glossary/db";
import { getDb } from "@/lib/db";
import { queueWikiIndex, scheduleWikiRagIndexing } from "@/lib/rag/wiki-indexer";
import { slugify } from "@/lib/terms/slug";

const MAX_TITLE_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 600;
const MAX_SLUG_LENGTH = 120;
const MAX_DOMAIN_LENGTH = 200;
const MAX_TERM_LINKS = 20;
const MAX_SOURCE_URL_LENGTH = 2_000;
export const MAX_WIKI_CONTENT_LENGTH = 200_000;
const RESERVED_WIKI_SLUGS = new Set(["new", "page"]);

export type WikiPage = InferSelectModel<typeof wikiPages>;
export type WikiPageStatus = (typeof wikiPageStatusEnum.enumValues)[number];

export interface WikiTermLink {
  id: string;
  slug: string;
  title: string;
  role: "primary" | "related";
  domain: string[];
}

export interface WikiPageWithTerms extends WikiPage {
  terms: WikiTermLink[];
}

export interface WikiPageInput {
  slug?: string;
  title: string;
  summary: string | null;
  sourceUrl?: string | null;
  content: string;
  domain: string[];
  termIds: string[];
  status?: WikiPageStatus;
}

export interface WikiPagePatch {
  slug?: string;
  title?: string;
  summary?: string | null;
  sourceUrl?: string | null;
  content?: string;
  domain?: string[];
  termIds?: string[];
  status?: WikiPageStatus;
}

export interface ListWikiPagesOptions {
  query?: string;
  status?: WikiPageStatus;
  domain?: string;
  termId?: string;
  page: number;
  pageSize: number;
}

function normalized(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizedSummary(value: string | null | undefined): string | null {
  const result = value === null || value === undefined ? "" : normalized(value);
  return result ? result : null;
}

function normalizedSourceUrl(value: string | null | undefined): string | null {
  const result = value === null || value === undefined ? "" : value.trim();
  return result ? result : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hashContent(input: Pick<WikiPageInput, "title" | "summary" | "sourceUrl" | "content" | "domain" | "termIds">): string {
  return createHash("sha256").update(JSON.stringify({
    title: input.title,
    summary: input.summary,
    sourceUrl: input.sourceUrl,
    content: input.content,
    domain: input.domain,
    termIds: input.termIds,
  }), "utf8").digest("hex");
}

function titleOf(term: { nameKo: string | null; nameEn: string | null }): string {
  return term.nameKo || term.nameEn || "이름 없는 용어";
}

function validateSlug(slug: string): void {
  if (!slug || slug.length > MAX_SLUG_LENGTH || RESERVED_WIKI_SLUGS.has(slug)) {
    throw new Error("위키 주소를 확인해 주세요.");
  }
}

function validateInput(input: WikiPageInput): void {
  if (!input.title.trim() || input.title.length > MAX_TITLE_LENGTH) throw new Error("위키 제목을 확인해 주세요.");
  if (input.summary && input.summary.length > MAX_SUMMARY_LENGTH) throw new Error("위키 요약은 600자 이하여야 합니다.");
  if (input.sourceUrl && (input.sourceUrl.length > MAX_SOURCE_URL_LENGTH || !isHttpUrl(input.sourceUrl))) throw new Error("위키 출처 URL은 http 또는 https 주소여야 합니다.");
  if (!input.content.trim() || input.content.length > MAX_WIKI_CONTENT_LENGTH) throw new Error("위키 본문은 1자 이상 200,000자 이하여야 합니다.");
  if (input.domain.length > 20 || input.domain.some((value) => value.length > MAX_DOMAIN_LENGTH)) throw new Error("위키 도메인을 확인해 주세요.");
  if (input.termIds.length > MAX_TERM_LINKS) throw new Error("연결할 용어는 20개 이하여야 합니다.");
  if (input.slug !== undefined) validateSlug(input.slug);
}

function normalizeInput(input: WikiPageInput): WikiPageInput {
  return {
    ...input,
    slug: input.slug === undefined ? undefined : slugify(normalized(input.slug)),
    title: normalized(input.title),
    summary: normalizedSummary(input.summary),
    sourceUrl: normalizedSourceUrl(input.sourceUrl),
    content: input.content.replace(/\r\n?/g, "\n").trim(),
    domain: [...new Set(input.domain.map(normalized).filter(Boolean))],
    termIds: [...new Set(input.termIds)],
  };
}

function normalizePatch(patch: WikiPagePatch): WikiPagePatch {
  return {
    ...patch,
    ...(patch.slug !== undefined ? { slug: slugify(normalized(patch.slug)) } : {}),
    ...(patch.title !== undefined ? { title: normalized(patch.title) } : {}),
    ...(patch.summary !== undefined ? { summary: normalizedSummary(patch.summary) } : {}),
    ...(patch.sourceUrl !== undefined ? { sourceUrl: normalizedSourceUrl(patch.sourceUrl) } : {}),
    ...(patch.content !== undefined ? { content: patch.content.replace(/\r\n?/g, "\n").trim() } : {}),
    ...(patch.domain !== undefined ? { domain: [...new Set(patch.domain.map(normalized).filter(Boolean))] } : {}),
    ...(patch.termIds !== undefined ? { termIds: [...new Set(patch.termIds)] } : {}),
  };
}

async function slugTaken(slug: string, excludePageId?: string): Promise<boolean> {
  const [term] = await getDb().select({ id: terms.id }).from(terms).where(eq(terms.slug, slug)).limit(1);
  if (term) return true;
  const conditions = [eq(wikiPages.slug, slug), ...(excludePageId ? [sql`${wikiPages.id} <> ${excludePageId}`] : [])];
  const [page] = await getDb().select({ id: wikiPages.id }).from(wikiPages).where(and(...conditions)).limit(1);
  return Boolean(page);
}

async function uniqueSlug(title: string): Promise<string> {
  const seed = (slugify(title) || "page").slice(0, MAX_SLUG_LENGTH);
  let candidate = seed;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    if (!RESERVED_WIKI_SLUGS.has(candidate) && !(await slugTaken(candidate))) return candidate;
    const suffixText = `-${suffix}`;
    candidate = `${seed.slice(0, MAX_SLUG_LENGTH - suffixText.length)}${suffixText}`;
  }
  throw new Error("위키 주소를 만들지 못했습니다.");
}

async function termsForPage(pageId: string): Promise<WikiTermLink[]> {
  const rows = await getDb().select({
    id: terms.id,
    slug: terms.slug,
    nameEn: terms.nameEn,
    nameKo: terms.nameKo,
    domain: terms.domain,
    role: wikiPageTerms.role,
  }).from(wikiPageTerms)
    .innerJoin(terms, eq(terms.id, wikiPageTerms.termId))
    .where(eq(wikiPageTerms.wikiPageId, pageId))
    .orderBy(asc(wikiPageTerms.role), asc(terms.slug));
  return rows.map((row) => ({ id: row.id, slug: row.slug, title: titleOf(row), role: row.role, domain: row.domain }));
}

export async function getWikiPageBySlug(slug: string): Promise<WikiPageWithTerms | null> {
  const [page] = await getDb().select().from(wikiPages).where(eq(wikiPages.slug, slug)).limit(1);
  if (!page) return null;
  return { ...page, terms: await termsForPage(page.id) };
}

export async function getWikiPageById(id: string): Promise<WikiPageWithTerms | null> {
  const [page] = await getDb().select().from(wikiPages).where(eq(wikiPages.id, id)).limit(1);
  if (!page) return null;
  return { ...page, terms: await termsForPage(page.id) };
}

export async function listWikiPages(options: ListWikiPagesOptions): Promise<{ items: WikiPageWithTerms[]; total: number }> {
  const filters = [
    options.status ? eq(wikiPages.status, options.status) : sql`${wikiPages.status} <> 'archived'`,
    options.domain ? sql`${options.domain} = any(${wikiPages.domain})` : undefined,
    options.termId ? sql`exists (select 1 from wiki_page_terms wpt where wpt.wiki_page_id = ${wikiPages.id} and wpt.term_id = ${options.termId})` : undefined,
    options.query ? or(
      ilike(wikiPages.slug, `%${options.query}%`),
      ilike(wikiPages.title, `%${options.query}%`),
      ilike(wikiPages.summary, `%${options.query}%`),
      ilike(wikiPages.content, `%${options.query}%`),
    ) : undefined,
  ];
  const where = and(...filters);
  const db = getDb();
  const [totalRows, pages] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(wikiPages).where(where),
    db.select().from(wikiPages).where(where)
      .orderBy(desc(wikiPages.updatedAt), asc(wikiPages.slug))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
  ]);
  const items = await Promise.all(pages.map(async (page) => ({ ...page, terms: await termsForPage(page.id) })));
  return { items, total: totalRows[0]?.count ?? 0 };
}

export async function listWikiPagesForTerm(termId: string, limit = 8): Promise<WikiPageWithTerms[]> {
  const rows = await getDb().select({ page: wikiPages }).from(wikiPages)
    .innerJoin(wikiPageTerms, eq(wikiPageTerms.wikiPageId, wikiPages.id))
    .where(and(eq(wikiPageTerms.termId, termId), sql`${wikiPages.status} <> 'archived'`))
    .orderBy(desc(wikiPages.updatedAt), asc(wikiPages.slug))
    .limit(Math.max(1, Math.min(20, limit)));
  return Promise.all(rows.map(async ({ page }) => ({ ...page, terms: await termsForPage(page.id) })));
}

function snapshotOf(page: WikiPage, termIds: string[]) {
  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      sourceUrl: page.sourceUrl,
      content: page.content,
      contentHash: page.contentHash,
      domain: page.domain,
      revision: page.revision,
      status: page.status,
    },
    termIds,
  };
}

export async function createWikiPage(input: WikiPageInput, authorId: string | null, authorKeyId: string | null = null): Promise<WikiPageWithTerms> {
  const normalizedInput = normalizeInput(input);
  const slug = normalizedInput.slug || await uniqueSlug(normalizedInput.title);
  const prepared = { ...normalizedInput, slug };
  validateInput(prepared);
  if (await slugTaken(slug)) throw new Error("이미 사용 중인 위키 주소입니다.");
  const page = await getDb().transaction(async (tx) => {
    const [created] = await tx.insert(wikiPages).values({
      slug,
      title: prepared.title,
      summary: prepared.summary,
      sourceUrl: prepared.sourceUrl,
      content: prepared.content,
      contentHash: hashContent(prepared),
      domain: prepared.domain,
      revision: 1,
      status: prepared.status ?? "draft",
      createdBy: authorId,
      updatedBy: authorId,
    }).returning();
    if (!created) throw new Error("위키 문서를 저장하지 못했습니다.");
    if (prepared.termIds.length > 0) {
      await tx.insert(wikiPageTerms).values(prepared.termIds.map((termId, index) => ({
        wikiPageId: created.id,
        termId,
        role: index === 0 ? "primary" as const : "related" as const,
      })));
    }
    await tx.insert(wikiPageRevisions).values({
      wikiPageId: created.id,
      revisionNumber: 1,
      snapshot: snapshotOf(created, prepared.termIds),
      message: "created",
      authorId,
      authorKeyId,
    });
    await queueWikiIndex(tx, created.id, created.revision);
    return created;
  });
  scheduleWikiRagIndexing(2);
  return { ...page, terms: await termsForPage(page.id) };
}

export async function updateWikiPage(id: string, patch: WikiPagePatch, authorId: string | null, authorKeyId: string | null = null): Promise<WikiPageWithTerms | null> {
  const normalizedPatch = normalizePatch(patch);
  const [existing] = await getDb().select({ slug: wikiPages.slug }).from(wikiPages).where(eq(wikiPages.id, id)).limit(1);
  if (!existing) return null;
  if (normalizedPatch.slug !== undefined && normalizedPatch.slug !== existing.slug) {
    const [term] = await getDb().select({ id: terms.id }).from(terms).where(eq(terms.slug, normalizedPatch.slug)).limit(1);
    const [other] = await getDb().select({ id: wikiPages.id }).from(wikiPages).where(
      and(eq(wikiPages.slug, normalizedPatch.slug), sql`${wikiPages.id} <> ${id}`),
    ).limit(1);
    if (term || other) throw new Error("이미 사용 중인 위키 주소입니다.");
  }
  const result = await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(wikiPages).where(eq(wikiPages.id, id)).limit(1);
    if (!current) return null;
    const currentTerms = await tx.select({ termId: wikiPageTerms.termId }).from(wikiPageTerms).where(eq(wikiPageTerms.wikiPageId, id)).orderBy(asc(wikiPageTerms.role), asc(wikiPageTerms.termId));
    const next: WikiPageInput = {
      slug: normalizedPatch.slug ?? current.slug,
      title: normalizedPatch.title ?? current.title,
      summary: normalizedPatch.summary === undefined ? current.summary : normalizedPatch.summary,
      sourceUrl: normalizedPatch.sourceUrl === undefined ? current.sourceUrl : normalizedPatch.sourceUrl,
      content: normalizedPatch.content ?? current.content,
      domain: normalizedPatch.domain ?? current.domain,
      termIds: normalizedPatch.termIds ?? currentTerms.map((row) => row.termId),
      status: normalizedPatch.status ?? current.status,
    };
    validateInput(next);
    const contentChanged = next.slug !== current.slug || next.title !== current.title || next.summary !== current.summary || next.sourceUrl !== current.sourceUrl
      || next.content !== current.content || JSON.stringify(next.domain) !== JSON.stringify(current.domain)
      || JSON.stringify(next.termIds) !== JSON.stringify(currentTerms.map((row) => row.termId));
    const revision = contentChanged ? current.revision + 1 : current.revision;
    const [updated] = await tx.update(wikiPages).set({
      slug: next.slug,
      title: next.title,
      summary: next.summary,
      sourceUrl: next.sourceUrl,
      content: next.content,
      contentHash: hashContent(next),
      domain: next.domain,
      revision,
      status: next.status,
      updatedBy: authorId,
      updatedAt: new Date(),
    }).where(eq(wikiPages.id, id)).returning();
    if (!updated) return null;
    if (contentChanged) {
      await tx.delete(wikiPageTerms).where(eq(wikiPageTerms.wikiPageId, id));
      if (next.termIds.length > 0) {
        await tx.insert(wikiPageTerms).values(next.termIds.map((termId, index) => ({
          wikiPageId: id,
          termId,
          role: index === 0 ? "primary" as const : "related" as const,
        })));
      }
      await tx.insert(wikiPageRevisions).values({
        wikiPageId: id,
        revisionNumber: revision,
        snapshot: snapshotOf(updated, next.termIds),
        message: next.status !== current.status ? `status:${next.status}` : "updated",
        authorId,
        authorKeyId,
      });
    }
    await queueWikiIndex(tx, updated.id, updated.revision);
    return updated;
  });
  if (!result) return null;
  scheduleWikiRagIndexing(2);
  return { ...result, terms: await termsForPage(result.id) };
}

export function toWikiPageWire(page: WikiPageWithTerms, includeContent = false) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    sourceUrl: page.sourceUrl,
    ...(includeContent ? { content: page.content } : {}),
    domain: page.domain,
    revision: page.revision,
    status: page.status,
    terms: page.terms,
    createdBy: page.createdBy,
    updatedBy: page.updatedBy,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}
