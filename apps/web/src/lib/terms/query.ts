import { and, arrayContains, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces, termStatusEnum, termTypeEnum } from "@grossary/db";
import { isUuid } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export type TermType = (typeof termTypeEnum.enumValues)[number];
export type TermStatus = (typeof termStatusEnum.enumValues)[number];

// F6(review §2 Q1, PROTO C 대안): termType/status를 string으로 넓혀 두면
// STATUS_LABEL/KIND_LABEL 같은 화면 쪽 lookup 테이블에서 DB enum 값이
// 빠지거나 드리프트해도 tsc가 잡지 못한다. drizzle의 pgEnum 컬럼은 이미
// TermType/TermStatus 유니온을 추론하므로, 여기서 그 유니온으로 좁혀 두면
// 문자열 grep 없이 tsc가 공짜로 enum 드리프트를 잡는다.
export interface TermSummary {
  id: string;
  slug: string;
  termType: TermType;
  nameEn: string | null;
  nameKo: string | null;
  domain: string[];
  status: TermStatus;
}

export interface SurfaceRow {
  id: string;
  text: string;
  lang: string;
  kind: string;
  caseSensitive: boolean;
}

export interface TermDetail extends TermSummary {
  fullNameEn: string | null;
  fullNameKo: string | null;
  definitionMd: string | null;
  bodyMd: string | null;
  // R40: 목록은 이미 updatedAt으로 정렬하고, 위키 상세 페이지는 "최근 수정"을
  // 보여줘야 하므로 상세에만 정식으로 추가한다.
  updatedAt: Date;
  surfaces: SurfaceRow[];
  homonyms: TermSummary[];
}

// R62: `Response.json`은 Date를 ISO 문자열로 직렬화한다 — TermDetail.updatedAt은
// 라이브러리 함수(getTermByIdOrSlug)의 반환 타입으로는 Date가 맞지만, 그 값을
// 그대로 `Response.json`에 실어 보내면 실제 응답 바디는 string인데 타입은 Date라고
// 거짓말을 하는 셈이다 — 컴파일은 되지만 Task 12/13이 TermDetail을 fetch 결과
// 타입으로 재사용하면 런타임에 터진다. 라우트는 이 wire 타입으로 명시 직렬화한다.
export type TermDetailResponse = Omit<TermDetail, "updatedAt"> & { updatedAt: string };

const summaryColumns = {
  id: terms.id,
  slug: terms.slug,
  termType: terms.termType,
  nameEn: terms.nameEn,
  nameKo: terms.nameKo,
  domain: terms.domain,
  status: terms.status,
};

// R40: 브리프는 `db.select().from(terms)`로 전체 컬럼을 읽어 `{ ...term, ... }`으로
// 그대로 반환했다. object spread는 TypeScript의 초과 프로퍼티 검사를 피해가므로
// createdBy/updatedBy/replacedById/createdAt이 TermDetail에 없는데도 컴파일이
// 통과하고, 런타임 응답에는 그 컬럼들이 그대로 실린다 — Task 12/13은 TermDetail
// 타입을 보고 짜여지는데 실제 응답은 다른 모양이 된다. 여기서는 TermDetail이
// 선언한 필드만 명시적으로 select해서, spread하더라도 인터페이스와 정확히 같은
// 모양만 나오게 한다.
const detailColumns = {
  ...summaryColumns,
  fullNameEn: terms.fullNameEn,
  fullNameKo: terms.fullNameKo,
  definitionMd: terms.definitionMd,
  bodyMd: terms.bodyMd,
  updatedAt: terms.updatedAt,
};

export async function getTermByIdOrSlug(idOrSlug: string): Promise<TermDetail | null> {
  const db = getDb();
  const [term] = await db
    .select(detailColumns)
    .from(terms)
    .where(isUuid(idOrSlug) ? eq(terms.id, idOrSlug) : eq(terms.slug, idOrSlug))
    .limit(1);

  if (!term) return null;

  const surfaces = await db
    .select({
      id: termSurfaces.id,
      text: termSurfaces.text,
      lang: termSurfaces.lang,
      kind: termSurfaces.kind,
      caseSensitive: termSurfaces.caseSensitive,
      normLoose: termSurfaces.normLoose,
    })
    .from(termSurfaces)
    .where(eq(termSurfaces.termId, term.id));

  // 동음이의어: 이 용어의 표기 중 하나라도 normLoose가 같은, 다른 term.
  const keys = [...new Set(surfaces.map((s) => s.normLoose))];
  const homonyms = keys.length
    ? await db
        .selectDistinctOn([terms.id], summaryColumns)
        .from(terms)
        .innerJoin(termSurfaces, eq(termSurfaces.termId, terms.id))
        .where(and(inArray(termSurfaces.normLoose, keys), ne(terms.id, term.id)))
        .orderBy(terms.id)
    : [];

  return {
    ...term,
    surfaces: surfaces.map(({ normLoose: _ignored, ...rest }) => rest),
    homonyms,
  };
}

export interface ListParams {
  q?: string;
  termType?: TermType;
  domain?: string;
  status?: TermStatus;
  page: number;
  pageSize: number;
}

// R41: termType/status는 이미 알려진 union이라야 하는 값이다. 검증은 라우트가
// 맡는다(호출 전에 알 수 없는 값을 걸러 400을 돌려줘야 하므로) — listTerms는
// 이미 검증된 리터럴 타입만 받으므로 `as never` 캐스트 없이 그대로 eq()에 넘긴다.
export async function listTerms(params: ListParams): Promise<{ items: TermSummary[]; total: number }> {
  const db = getDb();
  const filters = [];

  if (params.termType) filters.push(eq(terms.termType, params.termType));
  if (params.status) filters.push(eq(terms.status, params.status));
  if (params.domain) filters.push(arrayContains(terms.domain, [params.domain]));

  if (params.q) {
    const { normLoose, normSpace } = surfaceKeys(params.q);
    const matching = db
      .select({ termId: termSurfaces.termId })
      .from(termSurfaces)
      .where(
        or(
          eq(termSurfaces.normLoose, normLoose),
          eq(termSurfaces.normSpace, normSpace),
          sql`${termSurfaces.normLoose} % ${normLoose}`,
        ),
      );
    filters.push(inArray(terms.id, matching));
  }

  const where = filters.length ? and(...filters) : undefined;

  const [items, [counted]] = await Promise.all([
    db
      .select(summaryColumns)
      .from(terms)
      .where(where)
      // R63: updatedAt은 defaultNow() = 트랜잭션 시작 시각이라, 한 트랜잭션에서
      // 만든 여러 row는 updatedAt이 완전히 같을 수 있다. updatedAt 단독 정렬은
      // 그런 동률 아래에서 LIMIT/OFFSET 페이지네이션에 안정적이지 않다(같은 행이
      // 두 페이지에 다시 나오거나, 어떤 행은 아예 안 나올 수 있다) — id를
      // 타이브레이커로 추가해 정렬을 전체 순서로 고정한다.
      .orderBy(desc(terms.updatedAt), desc(terms.id))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(terms).where(where),
  ]);

  return { items, total: counted?.total ?? 0 };
}
