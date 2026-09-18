import "server-only";

import { and, asc, inArray, sql } from "drizzle-orm";
import { termRevisions, terms } from "@glossary/db";
import { getDb } from "@/lib/db";
import { displayName } from "@/lib/ui/format";
import type { AiSuggestionDisposition } from "@/lib/ai/suggestion-dispositions";
import { isHiddenSuggestionDisposition, listSuggestionDispositionMap } from "@/lib/ai/suggestion-dispositions";
import { AI_SUGGESTION_GENERATOR_VERSIONS, classificationSuggestionId } from "@/lib/ai/suggestion-disposition-values";

export type ClassificationReviewKind = "domain" | "category";

export interface ClassificationReviewCandidate {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  nameKo: string | null;
  fullNameEn: string | null;
  fullNameKo: string | null;
  definitionMd: string | null;
  bodyMd: string | null;
  domain: string[];
  categories: string[];
  revision: number;
  disposition?: AiSuggestionDisposition;
}

/** 특정 분류 축이 비어 있는 용어를 오래된 수정 순으로 보여준다. */
export async function listClassificationReviewCandidates(
  kind: ClassificationReviewKind,
  limit = 200,
  query = "",
): Promise<ClassificationReviewCandidate[]> {
  const db = getDb();
  const missing = kind === "domain"
    ? sql`cardinality(${terms.domain}) = 0`
    : sql`cardinality(${terms.category}) = 0`;
  const conditions = [and(sql`${terms.replacedById} is null`, missing)!];
  const needle = query.trim().toLocaleLowerCase();
  if (needle) {
    conditions.push(sql`strpos(lower(concat_ws(' ', ${terms.nameKo}, ${terms.nameEn}, ${terms.fullNameKo}, ${terms.fullNameEn}, ${terms.slug})), ${needle}) > 0`);
  }
  const rows = await db
    .select({
      id: terms.id,
      slug: terms.slug,
      nameEn: terms.nameEn,
      nameKo: terms.nameKo,
      fullNameEn: terms.fullNameEn,
      fullNameKo: terms.fullNameKo,
      definitionMd: terms.definitionMd,
      bodyMd: terms.bodyMd,
      domain: terms.domain,
      categories: terms.category,
    })
    .from(terms)
    .where(and(...conditions))
    .orderBy(asc(terms.updatedAt), asc(terms.id))
    .limit(Math.min(200, Math.max(1, limit)));

  const revisions = rows.length > 0
    ? await db
      .select({
        termId: termRevisions.termId,
        revision: sql<number>`max(${termRevisions.revisionNumber})::int`,
      })
      .from(termRevisions)
      .where(inArray(termRevisions.termId, rows.map((row) => row.id)))
      .groupBy(termRevisions.termId)
    : [];
  const revisionByTerm = new Map(revisions.map((revision) => [revision.termId, revision.revision]));

  return rows.map((row) => ({
    ...row,
    name: displayName(row),
    revision: revisionByTerm.get(row.id) ?? 0,
  }));
}

export async function filterClassificationReviewCandidates(
  candidates: readonly ClassificationReviewCandidate[],
  kind: ClassificationReviewKind,
  userId: string | null,
): Promise<ClassificationReviewCandidate[]> {
  const decisions = await listSuggestionDispositionMap(
    candidates.map((candidate) => ({ termId: candidate.id, revision: candidate.revision })),
    "classification",
    userId,
    AI_SUGGESTION_GENERATOR_VERSIONS.classification,
  );
  return candidates.flatMap((candidate) => {
    const decision = decisions.get(`${candidate.id}:${candidate.revision}:${classificationSuggestionId(kind)}`);
    if (decision && isHiddenSuggestionDisposition(decision.disposition)) return [];
    return [{ ...candidate, disposition: decision?.disposition }];
  });
}
