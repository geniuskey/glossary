import { desc, eq, sql } from "drizzle-orm";
import { surfaceKeys, terms, termRevisions, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";
import { checkSurfaceConflicts } from "./schema";
import { findDuplicates, type DuplicateWarning } from "./create";
import { defaultCaseSensitive, deriveSurfaces, type CanonicalNames } from "./surfaces";
import type { SurfaceInput, TermInput } from "./schema";

export type TermUpdate = Partial<TermInput>;

export interface RevisionRow {
  id: string;
  revisionNumber: number;
  message: string | null;
  authorId: string | null;
  createdAt: Date;
}

// R62/R67 wire type: createdAt은 Date로 오지만 응답 바디에는 ISO 문자열로 실어야
// 한다. 라우트가 이 타입으로 payload를 명시 선언하면 .toISOString() 누락이
// tsc 오류가 된다(런타임 테스트로는 못 잡는다 — JSON.stringify가 Date를 조용히
// 문자열로 바꿔주기 때문).
export type RevisionRowResponse = Omit<RevisionRow, "createdAt"> & { createdAt: string };

export type UpdateTermResult =
  | { term: typeof terms.$inferSelect; surfaces: (typeof termSurfaces.$inferSelect)[]; warnings: DuplicateWarning[] }
  | { conflict: true; currentRevision: number }
  | { invalid: true; issues: string[] };

export async function listRevisions(termId: string): Promise<RevisionRow[]> {
  return getDb()
    .select({
      id: termRevisions.id,
      revisionNumber: termRevisions.revisionNumber,
      message: termRevisions.message,
      authorId: termRevisions.authorId,
      createdAt: termRevisions.createdAt,
    })
    .from(termRevisions)
    .where(eq(termRevisions.termId, termId))
    .orderBy(desc(termRevisions.revisionNumber));
}

export async function deleteTerm(termId: string): Promise<boolean> {
  // term_revisions/term_surfaces는 terms.id를 ON DELETE CASCADE로 참조하므로
  // 이 한 번의 delete로 리비전 이력과 표기가 함께 사라진다.
  const deleted = await getDb().delete(terms).where(eq(terms.id, termId)).returning({ id: terms.id });
  return deleted.length > 0;
}

// R48과 같은 판별 패턴: SQLSTATE 23505 중 term_revisions_unique 위반만 리비전
// 번호 경합으로 취급한다. 다른 23505를 여기서 삼키면 진짜 무결성 문제를 숨긴다.
export function isRevisionConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === "term_revisions_unique";
}

async function currentRevisionNumber(termId: string): Promise<number> {
  const [latest] = await getDb()
    .select({ n: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
    .from(termRevisions)
    .where(eq(termRevisions.termId, termId));
  return latest?.n ?? 0;
}

export async function updateTerm(
  termId: string,
  input: TermUpdate,
  authorId: string | null,
  expectedRevision?: number,
  authorKeyId: string | null = null,
): Promise<UpdateTermResult> {
  const db = getDb();

  const [oldTerm] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
  if (!oldTerm) throw new Error(`updateTerm: term ${termId}를 찾을 수 없습니다.`);

  const oldSurfaceRows = await db
    .select({
      text: termSurfaces.text,
      lang: termSurfaces.lang,
      kind: termSurfaces.kind,
      caseSensitive: termSurfaces.caseSensitive,
      normLoose: termSurfaces.normLoose,
    })
    .from(termSurfaces)
    .where(eq(termSurfaces.termId, termId));

  // R51: PATCH에 surfaces가 없다고 표기를 통째로 지우면 안 된다. "이 term의 이름
  // 필드만으로(명시 표기 없이) 다시 파생시켰을 때 나오는 정규화 키:kind 집합"과
  // 저장된 행을 비교해서, 그 집합 밖에 있는 저장 행만 사용자가 직접 추가한
  // 명시 표기로 취급한다. deriveSurfaces의 dedup 키(`normLoose:kind`)와 정확히
  // 같은 규칙을 써야 파생/명시 판정이 create 경로와 어긋나지 않는다.
  const derivedFromOld = deriveSurfaces(oldTerm, []);
  const derivedKeys = new Set(derivedFromOld.map((s) => `${surfaceKeys(s.text).normLoose}:${s.kind}`));
  const storedExplicit: SurfaceInput[] = oldSurfaceRows
    .filter((r) => !derivedKeys.has(`${r.normLoose}:${r.kind}`))
    .map((r) => ({ text: r.text, lang: r.lang, kind: r.kind, caseSensitive: r.caseSensitive }));

  // surfaces가 요청에 명시되면(빈 배열이라도) 그 값으로 명시 표기 전체를
  // 교체한다. undefined일 때만 기존 명시 표기를 그대로 이어간다.
  const explicitSurfaces = input.surfaces !== undefined ? input.surfaces : storedExplicit;

  const mergedNames: CanonicalNames = {
    termType: input.termType ?? oldTerm.termType,
    nameEn: input.nameEn !== undefined ? input.nameEn : oldTerm.nameEn,
    nameKo: input.nameKo !== undefined ? input.nameKo : oldTerm.nameKo,
    fullNameEn: input.fullNameEn !== undefined ? input.fullNameEn : oldTerm.fullNameEn,
    fullNameKo: input.fullNameKo !== undefined ? input.fullNameKo : oldTerm.fullNameKo,
  };

  const nextSurfaces = deriveSurfaces(mergedNames, explicitSurfaces);

  // R52: termInputSchema의 superRefine은 생성 시점 표기 집합에만 적용된다. patch의
  // 최종 표기 집합(파생 + 명시)은 기존 행과 병합해야만 알 수 있어 zod 시점엔 아예
  // 보이지 않는다 — 여기서 병합된 집합에 대해 직접 checkSurfaceConflicts를 호출한다.
  // 아무 것도 쓰기 전에 검증하므로, 유효하지 않으면 트랜잭션을 열 필요조차 없다.
  const issues = checkSurfaceConflicts(nextSurfaces);
  if (issues.length) return { invalid: true, issues };

  // R32 선례와 동일하게, 중복 경고는 저장 결과에 영향을 주지 않는 읽기 전용
  // 조회라 트랜잭션 밖에서 수행한다. R56: 자기 자신의 기존 표기와는 충돌로
  // 보지 않는다.
  const warnings = await findDuplicates(nextSurfaces, termId);

  try {
    return await db.transaction(async (tx) => {
      // R53: 리비전 번호는 실제 insert 직전에 트랜잭션 안에서 다시 읽어야
      // 경합 창을 최소화한다. R54: 두 요청이 여기서 같은 값을 봐도, 실제로
      // 경합하면 term_revisions_unique가 아래 insert에서 23505를 던진다.
      const [latest] = await tx
        .select({ n: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
        .from(termRevisions)
        .where(eq(termRevisions.termId, termId));
      const currentRevision = latest?.n ?? 0;

      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        return { conflict: true, currentRevision };
      }

      // R53: terms UPDATE / term_surfaces 교체 / term_revisions insert를 하나의
      // 트랜잭션으로 묶는다(R32의 연장). 이 셋이 독립 statement면 중간 실패 시
      // 리비전 없는 수정이나 표기가 지워진 채로 남는 term이 생길 수 있다.
      const [updated] = await tx
        .update(terms)
        .set({
          ...(input.termType !== undefined ? { termType: input.termType } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.nameKo !== undefined ? { nameKo: input.nameKo } : {}),
          ...(input.fullNameEn !== undefined ? { fullNameEn: input.fullNameEn } : {}),
          ...(input.fullNameKo !== undefined ? { fullNameKo: input.fullNameKo } : {}),
          ...(input.domain !== undefined ? { domain: input.domain } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.definitionMd !== undefined ? { definitionMd: input.definitionMd } : {}),
          // R55: 브리프 원안은 bodyMd를 .set()에서 빠뜨려, 생성 후에는 body_md를
          // 채울 방법이 patch에도 없었다.
          ...(input.bodyMd !== undefined ? { bodyMd: input.bodyMd } : {}),
          // R55: authorId가 null인 건 "API 키로 인증됨"을 뜻할 뿐 "저자를 모름"이
          // 아니다. 여기서 updatedBy를 null로 덮으면 이전에 실제 사용자가 남긴
          // 값을 지운다 — 이 편집을 실제로 누가 했는지는 아래 authorKeyId로
          // term_revisions에 남는다.
          ...(authorId !== null ? { updatedBy: authorId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(terms.id, termId))
        .returning();

      if (!updated) throw new Error(`updateTerm: term ${termId}가 갱신 중 사라졌습니다.`);

      // 표기를 통째로 지우고 다시 넣는다. 부분 갱신보다 단순하고, 리비전
      // 스냅샷이 항상 완전한 상태를 담게 된다.
      await tx.delete(termSurfaces).where(eq(termSurfaces.termId, termId));
      const savedSurfaces = nextSurfaces.length
        ? await tx
            .insert(termSurfaces)
            .values(
              nextSurfaces.map((s) => ({
                termId,
                text: s.text,
                lang: s.lang,
                kind: s.kind,
                caseSensitive: s.caseSensitive ?? defaultCaseSensitive(s.text),
                ...surfaceKeys(s.text),
              })),
            )
            .returning()
        : [];

      await tx.insert(termRevisions).values({
        termId,
        revisionNumber: currentRevision + 1,
        snapshot: { term: updated, surfaces: savedSurfaces },
        message: "updated",
        authorId,
        // R55: API 키로 만든 리비전은 authorId가 항상 null이라, authorKeyId를
        // 지금 기록해야만 나중에 누가 썼는지 복원할 수 있다(R47과 같은 이유).
        authorKeyId,
      });

      return { term: updated, surfaces: savedSurfaces, warnings };
    });
  } catch (err) {
    // R54: READ COMMITTED는 "같은 currentRevision을 읽고 동시에 revisionNumber+1을
    // insert"하는 경합을 막지 못한다. 나중에 커밋을 시도한 쪽의 insert가
    // term_revisions_unique에서 23505를 던지면, 그건 정말로 누군가 먼저 썼다는
    // 뜻이므로 409로 정직하게 알린다.
    if (isRevisionConflict(err)) {
      return { conflict: true, currentRevision: await currentRevisionNumber(termId) };
    }
    throw err;
  }
}
