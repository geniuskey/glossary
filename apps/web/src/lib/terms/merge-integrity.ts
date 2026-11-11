import { inArray, sql } from "drizzle-orm";
import { terms } from "@glossary/db";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/**
 * 병합된 용어는 replaced_by_id로 대표 용어를 가리키는데, 이 컬럼에는 FK가 없다.
 * 대표 용어만 지우면 원래 용어는 없는 id를 가리킨 채 남고, 병합된 용어라 검색·목록·
 * 표기 조회에서 빠지며 updateTerm도 거부한다 — 아무 화면에서도 보이지 않고 고칠 수도
 * 없는 행이 조용히 생긴다. 원래 용어의 표기와 설명은 병합 때 이미 대표 용어로 옮겨졌으니,
 * 대표 용어를 지우면 거기 병합된 용어도 함께 지운다(사슬 전체, 순환이 있어도 멈춘다).
 */
export async function deleteTermsWithMergedSources(db: Executor, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE merged(id) AS (
      SELECT id FROM ${terms} WHERE id IN (${idList})
      UNION
      SELECT t.id FROM ${terms} t JOIN merged m ON t.replaced_by_id = m.id
    )
    SELECT id FROM merged
  `);
  const all = [...rows].map((row) => row.id);
  if (all.length === 0) return [];
  const deleted = await db.delete(terms).where(inArray(terms.id, all)).returning({ id: terms.id });
  return deleted.map((row) => row.id);
}

/**
 * 병합 사슬이 살아 있는 용어에 닿지 못하는 용어들 — 자기 자신이나 서로를 가리키는 순환,
 * 또는 없는 용어를 가리키는 경우. mergeTerms는 이런 상태를 만들지 않지만 동기화
 * 가져오기는 출처의 replaced_by_id를 받아 쓰므로, 쓴 뒤에 이 함수로 검사한다.
 */
export async function brokenMergeIds(db: Executor): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE walk(start_id, id, path) AS (
      SELECT t.id, t.replaced_by_id, ARRAY[t.id] FROM ${terms} t WHERE t.replaced_by_id IS NOT NULL
      UNION ALL
      SELECT w.start_id, t.replaced_by_id, w.path || t.id
      FROM walk w JOIN ${terms} t ON t.id = w.id
      WHERE t.replaced_by_id IS NOT NULL AND NOT w.id = ANY(w.path)
    )
    SELECT DISTINCT w.start_id AS id
    FROM walk w LEFT JOIN ${terms} t ON t.id = w.id
    WHERE t.id IS NULL OR w.id = ANY(w.path)
    ORDER BY 1
  `);
  return [...rows].map((row) => row.id);
}
