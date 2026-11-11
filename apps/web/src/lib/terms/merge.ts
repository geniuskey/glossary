import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { terms, termSurfaces, termRevisions } from "@glossary/db";
import { getDb } from "@/lib/db";
import { termInputSchema } from "./schema";
import { mergeContent, type MergeContent } from "./merge-values";
import { updateTerm } from "./update";

/**
 * 병합 사슬을 끝까지 따라가 지금 살아 있는 대표 용어의 slug를 돌려준다. 닿지 못하면 null.
 *
 * 한 단계만 보면 replaced_by_id가 자기 자신이거나 A→B→A로 돌 때 상세 화면이
 * `/g/a` → `/g/b` → `/g/a`를 끝없이 307로 주고받아 브라우저가
 * ERR_TOO_MANY_REDIRECTS를 낸다(0.3.4 이미지에서 실측). 쓰는 쪽(삭제, 동기화 가져오기)이
 * 이제 그런 상태를 막지만(merge-integrity.ts), 그 전에 쌓인 데이터가 남아 있을 수 있다.
 * 사슬 중간의 대상이 지워졌으면 그 앞의 용어도 병합된 용어라 목적지가 될 수 없다.
 */
export async function mergedDestination(id: string): Promise<string | null> {
  const db = getDb();
  const visited = new Set([id]);
  let current = id;
  for (;;) {
    const [next] = await db
      .select({ id: terms.id, slug: terms.slug, target: terms.replacedById })
      .from(terms)
      .where(sql`${terms.id} = (select ${terms.replacedById} from ${terms} where ${terms.id} = ${current})`);
    // 병합되지 않은 용어이거나, 가리키는 대상이 지워진 경우.
    if (!next) return null;
    if (visited.has(next.id)) return null;
    if (!next.target) return next.slug;
    visited.add(next.id);
    current = next.id;
  }
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
