import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { terms, termSurfaces, termRevisions } from "@glossary/db";
import { getDb } from "@/lib/db";
import { termInputSchema } from "./schema";
import { mergeContent, type MergeContent } from "./merge-values";
import { updateTerm } from "./update";

export async function mergedDestination(id: string): Promise<string | null> {
  const [row] = await getDb().select({ target: terms.replacedById }).from(terms).where(eq(terms.id, id));
  if (!row?.target) return null;
  const [target] = await getDb().select({ slug: terms.slug }).from(terms).where(eq(terms.id, row.target));
  return target?.slug ?? null;
}

export async function mergeTerms(sourceId: string, targetId: string, sourceRevision: number, targetRevision: number, authorId: string | null, authorKeyId: string | null) {
  if (sourceId === targetId) throw new Error("서로 다른 용어를 선택해 주세요.");
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(terms).where(inArray(terms.id, [sourceId, targetId])).orderBy(asc(terms.id)).for("update");
    const source = rows.find((r) => r.id === sourceId), target = rows.find((r) => r.id === targetId);
    if (!source || !target || source.replacedById || target.replacedById) throw new Error("용어가 삭제되었거나 이미 병합되었습니다. 다시 검토해 주세요.");
    const revisions = await tx.select({ id: termRevisions.termId, revision: sql<number>`max(${termRevisions.revisionNumber})::int` })
      .from(termRevisions).where(inArray(termRevisions.termId, [sourceId, targetId])).groupBy(termRevisions.termId);
    if (revisions.find((r) => r.id === sourceId)?.revision !== sourceRevision || revisions.find((r) => r.id === targetId)?.revision !== targetRevision) {
      throw new Error("검토 후 용어가 변경되었습니다. 다시 검토해 주세요.");
    }
    const surfaces = await tx.select().from(termSurfaces).where(inArray(termSurfaces.termId, [sourceId, targetId]));
    const content = (row: typeof source): MergeContent => ({ ...row, category: row.category,
      definitionMd: row.definitionMd ?? "", bodyMd: row.bodyMd ?? "",
      surfaces: surfaces.filter((s) => s.termId === row.id),
    });
    const patch = termInputSchema.parse({ ...mergeContent(content(target), content(source)), qualityProfile: target.qualityProfile });
    const result = await updateTerm(targetId, patch, authorId, targetRevision, authorKeyId, `merged from /${source.slug}`, async (writeTx) => {
      const [archived] = await writeTx.update(terms).set({ replacedById: targetId, updatedAt: new Date(), ...(authorId ? { updatedBy: authorId } : {}) })
        .where(eq(terms.id, sourceId)).returning();
      await writeTx.update(terms).set({ replacedById: targetId }).where(eq(terms.replacedById, sourceId));
      await writeTx.insert(termRevisions).values({ termId: sourceId, revisionNumber: sourceRevision + 1,
        snapshot: { term: archived!, surfaces: surfaces.filter((s) => s.termId === sourceId) },
        message: `merged into /${target.slug}`, authorId, authorKeyId });
    }, tx);
    if (!("term" in result)) throw new Error("병합 내용을 저장하지 못했습니다. 표기 충돌 또는 수정 여부를 확인해 주세요.");
    return { slug: target.slug };
  });
}
