import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { terms, termSurfaces } from "@glossary/db";
import { compileLexicon, type CompiledLexicon, type LexiconEntry } from "@glossary/engine";
import { getDb } from "@/lib/db";

export interface LexiconSnapshot {
  version: string;
  entries: LexiconEntry[];
  compiled: CompiledLexicon;
}

/**
 * The validator consumes only complete, non-merged terms. Draft content is
 * intentionally excluded: a document should not fail CI because a term is
 * still being prepared in the workspace.
 */
export async function loadLexiconSnapshot(): Promise<LexiconSnapshot> {
  const rows = await getDb()
    .select({
      termId: terms.id,
      slug: terms.slug,
      surfaceId: termSurfaces.id,
      text: termSurfaces.text,
      kind: termSurfaces.kind,
    })
    .from(termSurfaces)
    .innerJoin(terms, eq(termSurfaces.termId, terms.id))
    .where(and(eq(terms.status, "active"), isNull(terms.replacedById)))
    .orderBy(asc(terms.id), asc(termSurfaces.id));

  const canonicalByTerm = new Map<string, { text: string; slug: string }>();
  for (const row of rows) {
    if (row.kind === "canonical" && !canonicalByTerm.has(row.termId)) {
      canonicalByTerm.set(row.termId, { text: row.text, slug: row.slug });
    }
  }

  const entries: LexiconEntry[] = rows.map((row) => ({
    termId: row.termId,
    slug: row.slug,
    text: row.text,
    kind: row.kind,
    replacement: row.kind === "discouraged" || row.kind === "forbidden"
      ? canonicalByTerm.get(row.termId) ?? null
      : null,
  }));
  const version = `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;

  return { version, entries, compiled: compileLexicon(entries, version) };
}
