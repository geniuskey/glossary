import { sql } from "drizzle-orm";
import { businessCategories, surfaceKeys, terms, termSurfaces } from "@glossary/db";
import { getDb } from "@/lib/db";
import { SUGGEST_LIMIT, type Suggestion } from "./search-ui";
import type { SurfaceKind, TermSummary } from "./query";

export interface SearchHit extends TermSummary {
  definitionMd: string | null;
  /**
   * 검색어가 실제로 맞은 표기. 표준명과 다를 수 있다("SoC"를 쳐서
   * System on Chip이 나오는 경우) — 그때 이 값이 `/w/<slug>?from=` 의 근거가
   * 된다. 어떤 표기 때문에 이 결과가 나왔는지 보여주지 않으면, 검색 결과가
   * 왜 나왔는지 알 수 없는 목록이 된다.
   */
  matchedText: string;
  matchedKind: SurfaceKind;
  /** 정규화 키가 정확히 같았는가. 유사도(오타 교정) 매치와 구분해 위로 올린다. */
  exact: boolean;
}

// drizzle의 execute<T>는 T가 Record<string, unknown>을 만족해야 한다. interface는
// 암묵적 인덱스 시그니처를 얻지 못하므로(SearchHit이 interface다) 매핑 타입으로
// 한 번 풀어 준다 — 필드는 그대로 따라간다.
type SearchRow = { [K in keyof SearchHit]: SearchHit[K] } & { score: number };
type SuggestionRow = { [K in keyof Suggestion]: Suggestion[K] } & { score: number };

/**
 * R135: 홈(`/`)의 검색. 시트의 목록 필터(listTermRows)와 달리 **표기 하나를
 * 지목해서** 돌려준다 — 사전에서 "SoC"를 찾은 사람에게 필요한 건 목록의 한
 * 줄이 아니라 "그 표기가 어느 개념의 무엇인가"이기 때문이다.
 *
 * 정규화는 언제나 engine(surfaceKeys)이 소유한다. 여기서 lower()/replace()로
 * 다시 만들면 DB에 저장된 norm_loose와 조용히 갈라진다(CLAUDE.md의 축).
 *
 * CTE로 짠 이유: 한 용어에 표기가 여러 개 걸리면(예: 표준명과 약어가 둘 다
 * 비슷하면) 같은 용어가 결과에 여러 줄로 나온다. `DISTINCT ON (term_id)`으로
 * 용어당 가장 좋은 표기 하나만 먼저 고르고, 그다음에 전체 랭킹을 매긴다 —
 * 순서를 뒤집으면 상위 N개가 한 용어의 표기들로 채워진다.
 */
export async function searchTerms(query: string, limit = 20): Promise<SearchHit[]> {
  const { normLoose, normSpace } = surfaceKeys(query);
  // 정규화 결과가 빈 문자열인 입력("---" 같은 것)은 매치의 대상이 될 수 없다.
  // 걸러내지 않으면 similarity('', ...)가 모든 행을 훑는다.
  if (!normLoose) return [];

  const rows = await getDb().execute<SearchRow>(sql`
    WITH scored AS (
      SELECT ts.term_id AS term_id,
             ts.text AS text,
             ts.kind AS kind,
             (ts.norm_loose = ${normLoose} OR ts.norm_space = ${normSpace}) AS exact,
             similarity(ts.norm_loose, ${normLoose}) AS score
      FROM ${termSurfaces} ts
      WHERE ts.norm_loose = ${normLoose}
         OR ts.norm_space = ${normSpace}
         OR ts.norm_loose % ${normLoose}
    ),
    best AS (
      SELECT DISTINCT ON (term_id) term_id, text, kind, exact, score
      FROM scored
      ORDER BY term_id, exact DESC, score DESC, text ASC
    )
    SELECT t.id AS "id", t.slug AS "slug", t.term_type AS "termType",
           t.name_en AS "nameEn", t.name_ko AS "nameKo", t.domain AS "domain",
           t.category AS "categories", t.category[1] AS "category",
           (SELECT bc.label FROM ${businessCategories} bc WHERE bc.key = t.category[1]) AS "categoryLabel",
           coalesce((SELECT array_agg(category_catalog.label ORDER BY selected.ordinality)
             FROM unnest(t.category) WITH ORDINALITY selected(category_key, ordinality)
             JOIN business_categories category_catalog ON category_catalog.key = selected.category_key), array[]::text[]) AS "categoryLabels",
           t.topic AS "topic", t.owner_id AS "ownerId",
           (SELECT CASE
              WHEN coalesce(cardinality(owner_user.sso_groups), 0) > 0
              THEN owner_user.name || ' · ' || array_to_string(owner_user.sso_groups, ', ')
              ELSE owner_user.name || ' · ' || owner_user.email
            END FROM users owner_user WHERE owner_user.id = t.owner_id) AS "ownerName",
           t.status AS "status", t.definition_md AS "definitionMd",
           b.text AS "matchedText", b.kind AS "matchedKind", b.exact AS "exact",
           b.score AS "score"
    FROM best b
    JOIN ${terms} t ON t.id = b.term_id
    WHERE t.status <> 'draft'
    ORDER BY b.exact DESC, b.score DESC, t.name_en ASC NULLS LAST, t.id
    LIMIT ${limit}
  `);

  return [...rows].map(({ score: _score, ...hit }) => hit);
}

// LIKE 패턴에서 `%`와 `_`는 와일드카드다. normalizeSurface는 `_`를 구분자로
// 지우지만 `%`는 남긴다 — "50%"를 치면 norm_loose가 "50%"가 되고, 이스케이프
// 없이 패턴에 넣으면 "50"으로 시작하는 모든 표기가 자동완성에 뜬다. 에러는
// 나지 않고 결과만 조용히 틀린다.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * R136: 검색창에 몇 자만 쳤을 때 뜨는 자동완성. searchTerms(전체 검색)와 두
 * 가지가 다르다.
 *
 * 1) **앞부분 매치가 있어야 한다.** trigram 유사도만으로는 "sy"에 "System on
 *    Chip"이 절대 안 걸린다(similarity가 임계값 근처도 못 간다) — 자동완성은
 *    글자 수가 적을 때 동작해야 의미가 있으므로 `norm_loose LIKE 'sy%'`를
 *    함께 건다. 유사도 매치는 그대로 두어 오타("systm")도 잡는다.
 * 2) **어느 쪽으로 걸렸는지 돌려준다**(`prefix`). 자동완성과 "유사한 표기"는
 *    화면에서 나뉘어야 한다(search-ui.ts의 groupSuggestions).
 *
 * 정렬은 exact → prefix → 유사도 순. 접두사 매치에서 trigram 유사도는 표기가
 * 길수록 낮아지므로("ae" 기준 AE > AEC > Aerodynamics), 유사도 하나로 두 묶음
 * 모두에서 "짧고 가까운 것 먼저"가 나온다.
 *
 * 성능: 한두 글자 접두사는 GIN trigram 인덱스가 못 받아 term_surfaces를 훑는다
 * (trigram은 3글자부터). 사내 용어집 규모(수천~수만 표기)에서는 문제가 아니라
 * 인덱스를 더 만들지 않았다 — 이 가정이 깨지면 norm_loose에
 * text_pattern_ops btree 인덱스를 추가하면 된다.
 */
export async function suggestTerms(query: string, limit = SUGGEST_LIMIT): Promise<Suggestion[]> {
  const { normLoose, normSpace } = surfaceKeys(query);
  if (!normLoose) return [];
  const pattern = `${escapeLike(normLoose)}%`;

  const rows = await getDb().execute<SuggestionRow>(sql`
    WITH scored AS (
      SELECT ts.term_id AS term_id,
             ts.text AS text,
             ts.kind AS kind,
             (ts.norm_loose = ${normLoose} OR ts.norm_space = ${normSpace}) AS exact,
             (ts.norm_loose LIKE ${pattern}) AS prefix,
             similarity(ts.norm_loose, ${normLoose}) AS score
      FROM ${termSurfaces} ts
      WHERE ts.norm_loose LIKE ${pattern}
         OR ts.norm_space = ${normSpace}
         OR ts.norm_loose % ${normLoose}
    ),
    best AS (
      SELECT DISTINCT ON (term_id) term_id, text, kind, exact, prefix, score
      FROM scored
      ORDER BY term_id, exact DESC, prefix DESC, score DESC, char_length(text), text
    )
    SELECT t.id AS "id", t.slug AS "slug",
           t.name_en AS "nameEn", t.name_ko AS "nameKo", t.status AS "status",
           b.text AS "matchedText", b.kind AS "matchedKind",
           b.exact AS "exact", b.prefix AS "prefix", b.score AS "score"
    FROM best b
    JOIN ${terms} t ON t.id = b.term_id
    WHERE t.status <> 'draft'
    ORDER BY b.exact DESC, b.prefix DESC, b.score DESC, char_length(b.text), t.id
    LIMIT ${limit}
  `);

  return [...rows].map(({ score: _score, ...hit }) => hit);
}
