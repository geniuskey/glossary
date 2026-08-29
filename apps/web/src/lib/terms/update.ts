import { desc, eq, sql } from "drizzle-orm";
import { apiKeys, surfaceKeys, terms, termRevisions, termSurfaces, users } from "@grossary/db";
import { getDb } from "@/lib/db";
import { checkSurfaceConflicts } from "./schema";
import { findDuplicates, type DuplicateWarning } from "./create";
import { defaultCaseSensitive, deriveSurfaces, pickExplicitSurfaces, type CanonicalNames } from "./surfaces";
import type { SurfaceInput, TermInput } from "./schema";

export type TermUpdate = Partial<TermInput>;

export interface RevisionRow {
  id: string;
  revisionNumber: number;
  message: string | null;
  authorId: string | null;
  // R79: API 키로 만든 리비전은 authorId가 항상 null이다 — R47이 authorKeyId를
  // term_revisions에 남긴 이유가 API 키 작성 리비전의 행위자를 나중에 복원하기
  // 위해서였는데, 이 목록이 그 컬럼을 숨기면 컬럼을 남긴 이유 자체가 없어진다.
  authorKeyId: string | null;
  // R115: id만으로는 이력 화면이 "누가"를 사람이 읽을 수 있는 이름으로 보여줄
  // 수 없다 — users/api_keys를 조인해 이름을 함께 싣는다. 사용자가 지워졌으면
  // (ON DELETE SET NULL) authorId는 남아도 authorName은 null일 수 있다.
  authorName: string | null;
  authorKeyName: string | null;
  createdAt: Date;
}

// R62/R67 wire type: createdAt은 Date로 오지만 응답 바디에는 ISO 문자열로 실어야
// 한다. 라우트가 이 타입으로 payload를 명시 선언하면 .toISOString() 누락이
// tsc 오류가 된다(런타임 테스트로는 못 잡는다 — JSON.stringify가 Date를 조용히
// 문자열로 바꿔주기 때문).
export type RevisionRowResponse = Omit<RevisionRow, "createdAt"> & { createdAt: string };

export interface UpdateTermSuccess {
  term: typeof terms.$inferSelect;
  surfaces: (typeof termSurfaces.$inferSelect)[];
  warnings: DuplicateWarning[];
}

// R81: 성공 변형에 이름을 준다. 라우트가 분기 체인 끝에서 `const ok:
// UpdateTermSuccess = result`로 받으면, 이 유니온에 변형이 추가됐는데 라우트가
// 분기를 빠뜨렸을 때 tsc 오류가 난다. 이름 없는 인라인 객체 타입이면 그
// 어긋남을 컴파일러가 볼 수 없다 — 리뷰가 실측한 결과, 5번째 변형을 추가해도
// 라우트에서는 진단이 하나도 나오지 않았고 런타임에 200 {"notFound":true}가
// 그대로 나갔다.
export type UpdateTermResult =
  | UpdateTermSuccess
  | { conflict: true; currentRevision: number }
  | { invalid: true; issues: string[] }
  // R75: 존재하지 않는 termId로 호출되는 건 레이스와 무관하게 도달 가능한 정상
  // 상태다(Task 13이 오래된/잘못된 id로 부를 수 있다) — updateTerm은 export된
  // 함수이므로 그 경우 맨 Error를 던지지 않고 판별 유니온으로 알려야 호출자가
  // 계약대로 분기할 수 있다.
  | { notFound: true };

export async function listRevisions(termId: string): Promise<RevisionRow[]> {
  return getDb()
    .select({
      id: termRevisions.id,
      revisionNumber: termRevisions.revisionNumber,
      message: termRevisions.message,
      authorId: termRevisions.authorId,
      authorKeyId: termRevisions.authorKeyId,
      // R115: authorId/authorKeyId 둘 다 nullable FK라 INNER JOIN이면 그
      // 리비전 자체가 결과에서 통째로 빠진다(예: 작성자가 나중에 삭제된 경우).
      // LEFT JOIN + coalesce 없이 그대로 두면 두 이름 다 null인 행도 정상이다.
      authorName: users.name,
      authorKeyName: apiKeys.name,
      createdAt: termRevisions.createdAt,
    })
    .from(termRevisions)
    .leftJoin(users, eq(users.id, termRevisions.authorId))
    .leftJoin(apiKeys, eq(apiKeys.id, termRevisions.authorKeyId))
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
  // R130: 되돌리기(revert.ts)가 같은 트랜잭션 규약을 그대로 쓰면서 리비전에만
  // 다른 메시지를 남길 수 있어야 한다. 이력 화면이 이 문자열을 그대로 보여준다.
  message = "updated",
): Promise<UpdateTermResult> {
  const db = getDb();

  const [oldTerm] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
  if (!oldTerm) return { notFound: true };

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

  // R51/R110: PATCH에 surfaces가 없다고 표기를 통째로 지우면 안 된다. "이 term의
  // 이름 필드만으로(명시 표기 없이) 다시 파생시켰을 때 나오는 정규화 키:kind
  // 집합"과 저장된 행을 비교해서, 그 집합 밖에 있는 저장 행만 사용자가 직접
  // 추가한 명시 표기로 취급한다. 이 판정은 편집 폼(Task 13)의 초기값 계산과도
  // 정확히 같아야 하므로 pickExplicitSurfaces로 소유권을 공유한다.
  const storedExplicit: SurfaceInput[] = pickExplicitSurfaces(oldTerm, oldSurfaceRows).map((r) => ({
    text: r.text,
    lang: r.lang,
    kind: r.kind,
    caseSensitive: r.caseSensitive,
  }));

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

  // R117: nameEn/nameKo가 nullable이 되면서(표에서 셀을 비울 수 있게) 두 표준명을
  // 모두 지우는 PATCH가 표현 가능해졌다. 그렇게 되면 그 용어는 어떤 이름으로도
  // 불릴 수 없고 파생 표기가 0개라 검색에서 영원히 사라진다 — 생성 경로는
  // termInputSchema의 refine이 이미 막고 있으므로, 수정 경로도 같은 불변식을
  // 지켜야 한다. patch 단독으로는 판정할 수 없고(둘 중 하나만 보내면 나머지는
  // 기존 값이다) 병합된 이름에 대해서만 판정할 수 있어 zod가 아니라 여기 있다.
  if (!mergedNames.nameEn && !mergedNames.nameKo) {
    return { invalid: true, issues: ["nameEn 또는 nameKo 중 최소 하나는 남아 있어야 합니다."] };
  }

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

      // R80: 여기는 도달 가능한 정상 상태다. 라우트의 존재 확인과 이 UPDATE
      // 사이에 term이 삭제되면(블로커 트랜잭션이 잡고 있던 DELETE가 커밋되는
      // 경우 결정론적으로 재현된다) UPDATE가 0행을 돌려준다. 맨 Error를 던지면
      // withApiErrors가 500으로 바꾸지만 옳은 답은 404다 — R75가 트랜잭션
      // '앞' 읽기에 대해 닫은 구멍과 같은 것이고, 이쪽 창이 더 넓다.
      if (!updated) return { notFound: true };

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
        message,
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
