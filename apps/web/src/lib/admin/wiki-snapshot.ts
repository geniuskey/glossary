import "server-only";

import { asc } from "drizzle-orm";
import { wikiPageTerms, wikiPages } from "@glossary/db";
import { getDb } from "@/lib/db";
import { WIKI_SNAPSHOT_FORMAT, WIKI_SNAPSHOT_VERSION } from "./wiki-snapshot-format";

export async function buildWikiSnapshot() {
  const db = getDb();
  const { pageRows, termLinkRows } = await db.transaction(async (tx) => {
    const [pageRows, termLinkRows] = await Promise.all([
      tx.select().from(wikiPages).orderBy(asc(wikiPages.slug), asc(wikiPages.id)),
      tx.select().from(wikiPageTerms).orderBy(asc(wikiPageTerms.wikiPageId), asc(wikiPageTerms.termId)),
    ]);
    return { pageRows, termLinkRows };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const byStatus = {
    draft: pageRows.filter((page) => page.status === "draft").length,
    published: pageRows.filter((page) => page.status === "published").length,
    archived: pageRows.filter((page) => page.status === "archived").length,
  };

  return {
    format: WIKI_SNAPSHOT_FORMAT,
    version: WIKI_SNAPSHOT_VERSION,
    readOnly: true,
    exportedAt: new Date().toISOString(),
    counts: {
      pages: pageRows.length,
      termLinks: termLinkRows.length,
      byStatus,
    },
    data: {
      pages: pageRows.map((page) => ({
        ...page,
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
        reviewedAt: page.reviewedAt?.toISOString() ?? null,
      })),
      termLinks: termLinkRows.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
      })),
    },
  };
}
