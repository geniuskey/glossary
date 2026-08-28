import { and, arrayContains, desc, eq, inArray, ne, or, sql, type AnyColumn } from "drizzle-orm";
import {
  surfaceKeys,
  surfaceKindEnum,
  terms,
  termRevisions,
  termSurfaces,
  termStatusEnum,
  termTypeEnum,
  users,
} from "@grossary/db";
import { isUuid } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { DEFAULT_DIR, DEFAULT_SORT, type SortDir, type SortKey, type TermRow } from "./grid";

export type TermType = (typeof termTypeEnum.enumValues)[number];
export type TermStatus = (typeof termStatusEnum.enumValues)[number];
export type SurfaceKind = (typeof surfaceKindEnum.enumValues)[number];

// F6(review §2 Q1, PROTO C 대안): termType/status/kind를 string으로 두면
// 화면 쪽 lookup 테이블이 DB enum과 드리프트해도 tsc가 못 잡는다.
// drizzle의 pgEnum 컬럼은 이미 이 유니온을 추론하므로 여기서 좁혀 둔다.
//
// 단, 이 좁힘 하나만으로는 드리프트가 안 잡힌다 — 수정 라운드 검증에서
// 직접 확인했다(P1: STATUS_LABEL에서 forbidden을 지워도 tsc exit 0).
// 받는 쪽이 `Record<string, string>` + `?? 폴백`이면 좁힌 타입이 그대로
// 다시 넓어지기 때문이다. 짝이 되는 규약은 lookup.ts의
// MATCH_KIND_PRIORITY처럼 **모든 lookup 테이블을 `Record<유니온, T>`로
// 선언하고 폴백을 두지 않는 것**이다(term-badges.tsx,
// app/terms/[slug]/page.tsx가 그렇게 되어 있다).
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
  kind: SurfaceKind;
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
  sort?: SortKey;
  dir?: SortDir;
  page: number;
  pageSize: number;
}

// R41: termType/status는 이미 알려진 union이라야 하는 값이다. 검증은 라우트가
// 맡는다(호출 전에 알 수 없는 값을 걸러 400을 돌려줘야 하므로) — listTerms는
// 이미 검증된 리터럴 타입만 받으므로 `as never` 캐스트 없이 그대로 eq()에 넘긴다.
function listFilters(params: ListParams) {
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

  return filters.length ? and(...filters) : undefined;
}

const SORT_COLUMNS: Record<SortKey, AnyColumn> = {
  updatedAt: terms.updatedAt,
  nameEn: terms.nameEn,
  nameKo: terms.nameKo,
  slug: terms.slug,
  termType: terms.termType,
  status: terms.status,
};

/**
 * R63: updatedAt은 defaultNow() = 트랜잭션 시작 시각이라, 한 트랜잭션에서 만든
 * 여러 row는 updatedAt이 완전히 같을 수 있다. 어떤 정렬 키를 쓰든 동률은
 * 생길 수 있고(nameEn이 둘 다 null인 경우가 특히 흔하다), 동률이 있는 정렬은
 * LIMIT/OFFSET 페이지네이션에 안정적이지 않다(같은 행이 두 페이지에 나오거나
 * 어떤 행은 아예 안 나온다) — id를 마지막 타이브레이커로 붙여 전체 순서로
 * 고정한다.
 *
 * nameEn/nameKo는 nullable이라 정렬 방향에 따라 null 덩어리가 목록 맨 앞에
 * 오면 표가 빈 줄부터 시작하는 것처럼 보인다. 방향과 무관하게 항상 뒤로 보낸다.
 */
function listOrder(sort: SortKey, dir: SortDir) {
  const column = SORT_COLUMNS[sort];
  const direction = dir === "asc" ? sql`asc` : sql`desc`;
  return [sql`${column} ${direction} nulls last`, desc(terms.id)];
}

export async function listTerms(params: ListParams): Promise<{ items: TermSummary[]; total: number }> {
  const db = getDb();
  const where = listFilters(params);

  const [items, [counted]] = await Promise.all([
    db
      .select(summaryColumns)
      .from(terms)
      .where(where)
      .orderBy(...listOrder(params.sort ?? DEFAULT_SORT, params.dir ?? DEFAULT_DIR))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(terms).where(where),
  ]);

  return { items, total: counted?.total ?? 0 };
}

/**
 * 표(그리드) 전용 목록. listTerms와 필터·정렬은 공유하지만 select가 다르다 —
 * 표는 "누가 언제 고쳤는지"와 셀 저장에 쓸 revision이 있어야 하고, 그 필드를
 * TermSummary에 넣으면 공개 API(GET /api/v1/terms) 응답 모양이 함께 바뀐다.
 *
 * revision은 상관 서브쿼리 하나로 함께 읽는다. 목록을 받은 뒤 id 배열로 다시
 * 조회하면 그 사이에 다른 사람이 저장한 리비전을 읽게 되어(협업 화면에서
 * 실제로 일어난다) 낙관적 동시성의 기준값이 오히려 틀어진다.
 */
export async function listTermRows(params: ListParams): Promise<{ items: TermRow[]; total: number }> {
  const db = getDb();
  const where = listFilters(params);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        ...summaryColumns,
        fullNameEn: terms.fullNameEn,
        fullNameKo: terms.fullNameKo,
        definitionMd: terms.definitionMd,
        updatedAt: terms.updatedAt,
        // updatedBy는 nullable FK다(API 키 수정이면 null이고, 사용자가 삭제되면
        // ON DELETE SET NULL로 null이 된다) — INNER JOIN이면 그런 행이 목록에서
        // 통째로 사라진다.
        editorName: users.name,
        revision: sql<number>`(
          select coalesce(max(${termRevisions.revisionNumber}), 0)::int
          from ${termRevisions}
          where ${termRevisions.termId} = ${terms.id}
        )`,
      })
      .from(terms)
      .leftJoin(users, eq(users.id, terms.updatedBy))
      .where(where)
      .orderBy(...listOrder(params.sort ?? DEFAULT_SORT, params.dir ?? DEFAULT_DIR))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(terms).where(where),
  ]);

  // R62와 같은 이유로 Date를 그대로 넘기지 않는다 — 이 값은 Client Component의
  // prop으로 직렬화되므로, 타입에서도 문자열이어야 거짓말이 아니다.
  const items = rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  return { items, total: counted?.total ?? 0 };
}

export interface Facet<T extends string = string> {
  value: T;
  count: number;
}

export interface TermFacets {
  domains: Facet[];
  types: Facet<TermType>[];
  statuses: Facet<TermStatus>[];
}

/**
 * 필터 UI에 쓸 실제 존재하는 값 목록. 특히 domain은 자유 텍스트 배열이라
 * 목록을 만들어 주지 않으면 화면에서 고를 방법이 아예 없다(주소창에 직접
 * `?domain=`을 치는 것 외에는 도달 불가능한 필터였다).
 *
 * 현재 필터와 무관한 전체 집계다. 필터를 반영하면 "지금 0건인 값"이 목록에서
 * 사라져서, 한 번 좁힌 뒤에는 다른 값으로 갈아탈 수 없게 된다.
 */
export async function termFacets(): Promise<TermFacets> {
  const db = getDb();

  // domain은 text[]다. unnest는 집합 반환 함수라 GROUP BY와 같은 SELECT 목록에
  // 둘 수 없다(Postgres 10+) — 먼저 펼친 서브쿼리를 만들고 그 결과를 센다.
  const unnested = db.select({ value: sql<string>`unnest(${terms.domain})`.as("value") }).from(terms).as("d");

  const [domains, types, statuses] = await Promise.all([
    db
      .select({ value: unnested.value, count: sql<number>`count(*)::int` })
      .from(unnested)
      .groupBy(unnested.value)
      .orderBy(sql`count(*) desc`, unnested.value)
      .limit(40),
    db
      .select({ value: terms.termType, count: sql<number>`count(*)::int` })
      .from(terms)
      .groupBy(terms.termType),
    db
      .select({ value: terms.status, count: sql<number>`count(*)::int` })
      .from(terms)
      .groupBy(terms.status),
  ]);

  return { domains, types, statuses };
}
