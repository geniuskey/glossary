import { and, arrayContains, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces, termStatusEnum, termTypeEnum } from "@grossary/db";
import { isUuid } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export type TermType = (typeof termTypeEnum.enumValues)[number];
export type TermStatus = (typeof termStatusEnum.enumValues)[number];

export interface TermSummary {
  id: string;
  slug: string;
  termType: string;
  nameEn: string | null;
  nameKo: string | null;
  domain: string[];
  status: string;
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
      .orderBy(desc(terms.updatedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(terms).where(where),
  ]);

  return { items, total: counted?.total ?? 0 };
}
