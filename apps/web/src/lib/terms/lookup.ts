import { eq, inArray, sql } from "drizzle-orm";
import { surfaceKeys, terms, termSurfaces, type Db } from "@grossary/db";
import { getDb } from "@/lib/db";
import type { SurfaceKind, TermStatus, TermSummary, TermType } from "./query";

export interface LookupResult {
  text: string;
  found: boolean;
  matchKind: string | null;
  terms: TermSummary[];
  similar: { slug: string; score: number }[];
}


/**
 * R85: `matches[0]?.kind`(계획서 스케치)는 ORDER BY 없는 행 순서에 의존해
 * 비결정적이고, 의미도 틀렸다 — 같은 표기가 alias이자 forbidden으로 등록돼
 * 있을 때 alias가 먼저 나오면 린터가 금지 표기를 놓친다. 우선순위를 코드에서
 * 명시 고정한다: forbidden > discouraged > canonical > abbreviation >
 * full_name > alias. Record<SurfaceKind, number>로 선언해서, surfaceKindEnum에
 * kind가 추가/변경되는데 이 표를 갱신하지 않으면 타입 검사가 실패한다(리터럴이
 * SurfaceKind의 키를 전부 포함해야 함) — "6종이 모두 있는지 타입으로 강제".
 *
 * R100: 우선순위는 구현 세부사항이 아니라 제품 규칙이다(R85) — export해서
 * 단위 테스트가 표 전체(인접 쌍 5개 + 셔플)를 직접 고정할 수 있게 한다.
 */
export const MATCH_KIND_PRIORITY: Record<SurfaceKind, number> = {
  forbidden: 0,
  discouraged: 1,
  canonical: 2,
  abbreviation: 3,
  full_name: 4,
  alias: 5,
};

export function pickMatchKind(kinds: SurfaceKind[]): SurfaceKind {
  return kinds.reduce((best, k) => (MATCH_KIND_PRIORITY[k] < MATCH_KIND_PRIORITY[best] ? k : best));
}

interface SimilarSuggestion {
  slug: string;
  score: number;
}

/**
 * R84: 계획서 스케치는 `for (const key of missing) { await db.select()... }`로
 * 미등록 키마다 쿼리를 하나씩 날린다 — 500개 상한을 다 채우면 한 요청이 500번
 * 왕복한다(500 상한을 둔 이유, "한 번의 호출이 DB를 오래 점유할 수 있다"를
 * 정면으로 위반). 여기서는 미등록 키 전체를 `unnest`로 한 번에 조인해 단일
 * 쿼리로 처리한다 — 왕복이 O(n)에서 O(1)이 된다.
 *
 * R89: `scored` CTE가 (key, term_id) 단위로 먼저 MAX(similarity)를 모은다 —
 * 한 용어의 여러 표기가 같은 키에 매치돼도 term_id 단위로 먼저 뭉쳐지므로,
 * 슬러그 기준 중복 제거가 랭킹 이전에 이미 끝나 있다. 그 다음 `ranked` CTE가
 * 키별로 점수 내림차순 rank를 매기고 상위 3개만 남긴다 — 슬러그가 이미
 * 유일하므로 "상위 3개가 전부 같은 용어" 문제가 구조적으로 발생하지 않는다.
 * score 동률은 slug 오름차순으로 더 끊어 정렬을 전체 순서로 고정한다(같은
 * 데이터에 대한 반복 쿼리라도 Postgres의 행 순서 자체는 보장되지 않는다).
 */
async function fetchSimilar(db: Db, missingKeys: string[]): Promise<Map<string, SimilarSuggestion[]>> {
  const result = new Map<string, SimilarSuggestion[]>();
  if (missingKeys.length === 0) return result;

  const keysArray = sql`ARRAY[${sql.join(
    missingKeys.map((k) => sql`${k}`),
    sql.raw(", "),
  )}]::text[]`;

  const rows = await db.execute<{ key: string; slug: string; score: number }>(sql`
    WITH missing_keys AS (
      SELECT unnest(${keysArray}) AS key
    ),
    scored AS (
      SELECT mk.key AS key, tm.id AS term_id, tm.slug AS slug,
             MAX(similarity(ts.norm_loose, mk.key)) AS score
      FROM missing_keys mk
      JOIN ${termSurfaces} ts ON ts.norm_loose % mk.key
      JOIN ${terms} tm ON tm.id = ts.term_id
      GROUP BY mk.key, tm.id, tm.slug
    ),
    ranked AS (
      SELECT key, slug, score,
             row_number() OVER (PARTITION BY key ORDER BY score DESC, slug ASC) AS rn
      FROM scored
    )
    SELECT key, slug, score FROM ranked WHERE rn <= 3 ORDER BY key, rn
  `);

  for (const row of rows) {
    const bucket = result.get(row.key) ?? [];
    bucket.push({ slug: row.slug, score: row.score });
    result.set(row.key, bucket);
  }
  return result;
}

// F6(review §2 Q1): TermSummary.termType/status를 TermType/TermStatus로 좁힌
// 파급 — 이 필드들도 같은 유니온으로 선언해야 아래에서 TermSummary로 조립할
// 때 string이 아닌 실제 enum 값임을 tsc가 알 수 있다(db.select가 실제로
// 돌려주는 값도 pgEnum 컬럼이라 이미 이 유니온이다).
interface MatchRow {
  normLoose: string;
  kind: SurfaceKind;
  id: string;
  slug: string;
  termType: TermType;
  nameEn: string | null;
  nameKo: string | null;
  domain: string[];
  status: TermStatus;
}

export async function lookupTerms(texts: string[]): Promise<LookupResult[]> {
  const db = getDb();
  // R87: text는 요청 원문 그대로 응답에 실어야 하므로 여기서 건드리지 않는다.
  // 정규화는 surfaceKeys가 맡는다. 정규화 결과가 빈 문자열이 되는 입력("---"류,
  // R46과 같은 함정)은 매치도 유사도 조회도 대상이 될 수 없으므로 걸러낸다.
  const keys = texts.map((t) => surfaceKeys(t).normLoose);
  const unique = [...new Set(keys.filter(Boolean))];

  const rows: MatchRow[] = unique.length
    ? await db
        .select({
          normLoose: termSurfaces.normLoose,
          kind: termSurfaces.kind,
          id: terms.id,
          slug: terms.slug,
          termType: terms.termType,
          nameEn: terms.nameEn,
          nameKo: terms.nameKo,
          domain: terms.domain,
          status: terms.status,
        })
        .from(termSurfaces)
        .innerJoin(terms, eq(terms.id, termSurfaces.termId))
        .where(inArray(termSurfaces.normLoose, unique))
        .orderBy(terms.slug)
    : [];

  const byKey = new Map<string, MatchRow[]>();
  for (const row of rows) {
    const bucket = byKey.get(row.normLoose) ?? [];
    bucket.push(row);
    byKey.set(row.normLoose, bucket);
  }

  const missing = unique.filter((k) => !byKey.has(k));
  const similarByKey = await fetchSimilar(db, missing);

  return texts.map((text, index) => {
    const key = keys[index]!;
    const matches = byKey.get(key) ?? [];
    const seen = new Set<string>();
    const matchedTerms: TermSummary[] = [];
    const kinds: SurfaceKind[] = [];

    for (const m of matches) {
      kinds.push(m.kind);
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      matchedTerms.push({
        id: m.id, slug: m.slug, termType: m.termType,
        nameEn: m.nameEn, nameKo: m.nameKo, domain: m.domain, status: m.status,
      });
    }

    return {
      text,
      found: matchedTerms.length > 0,
      matchKind: kinds.length > 0 ? pickMatchKind(kinds) : null,
      terms: matchedTerms,
      similar: matchedTerms.length > 0 ? [] : (similarByKey.get(key) ?? []),
    };
  });
}
