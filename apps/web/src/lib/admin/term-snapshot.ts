import "server-only";

import { asc, sql } from "drizzle-orm";
import {
  businessCategories,
  domains,
  termRelations,
  termRevisions,
  termSurfaces,
  terms,
} from "@glossary/db";
import { getDb } from "@/lib/db";
import {
  GLOSSARY_SNAPSHOT_FORMAT,
  GLOSSARY_SNAPSHOT_VERSION,
} from "./term-snapshot-format";

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export async function buildGlossarySnapshot() {
  const db = getDb();
  const [termRows, surfaceRows, relationRows, revisionRows, domainRows, categoryRows] = await Promise.all([
    db
      .select()
      .from(terms)
      .orderBy(asc(terms.slug), asc(terms.id)),
    db
      .select()
      .from(termSurfaces)
      .orderBy(asc(termSurfaces.termId), asc(termSurfaces.id)),
    db
      .select()
      .from(termRelations)
      .orderBy(asc(termRelations.sourceTermId), asc(termRelations.targetTermId), asc(termRelations.id)),
    db
      .select({
        termId: termRevisions.termId,
        revision: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int`,
      })
      .from(termRevisions)
      .groupBy(termRevisions.termId)
      .orderBy(asc(termRevisions.termId)),
    db
      .select()
      .from(domains)
      .orderBy(asc(domains.sortOrder), asc(domains.key)),
    db
      .select()
      .from(businessCategories)
      .orderBy(asc(businessCategories.sortOrder), asc(businessCategories.key)),
  ]);

  const currentRevision = new Map(revisionRows.map((row) => [row.termId, row.revision]));

  return {
    format: GLOSSARY_SNAPSHOT_FORMAT,
    version: GLOSSARY_SNAPSHOT_VERSION,
    readOnly: true,
    exportedAt: new Date().toISOString(),
    counts: {
      terms: termRows.length,
      surfaces: surfaceRows.length,
      relations: relationRows.length,
      domains: domainRows.length,
      businessCategories: categoryRows.length,
    },
    data: {
      terms: termRows.map((term) => ({
        ...term,
        currentRevision: currentRevision.get(term.id) ?? 0,
        createdAt: term.createdAt.toISOString(),
        updatedAt: term.updatedAt.toISOString(),
      })),
      surfaces: surfaceRows,
      relations: relationRows.map((relation) => ({
        ...relation,
        createdAt: relation.createdAt.toISOString(),
        reviewedAt: iso(relation.reviewedAt),
      })),
      domains: domainRows.map((domain) => ({
        ...domain,
        createdAt: domain.createdAt.toISOString(),
        updatedAt: domain.updatedAt.toISOString(),
      })),
      businessCategories: categoryRows.map((category) => ({
        ...category,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      })),
    },
  };
}
