import { and, eq, inArray, like, ne } from "drizzle-orm";
import { surfaceKeys, terms, termRevisions, termSurfaces } from "@grossary/db";
import { getDb } from "@/lib/db";
import { slugify } from "./slug";
import { defaultCaseSensitive, deriveSurfaces } from "./surfaces";
import type { SurfaceInput, TermInput } from "./schema";

export interface DuplicateWarning {
  normLoose: string;
  surfaceText: string;
  conflictingTermId: string;
  conflictingSlug: string;
}

// R86: `terms/lookup`는 정적 라우트 세그먼트다. Next는 정적 세그먼트를 동적
// 세그먼트(`terms/[idOrSlug]`)보다 먼저 매칭하므로, 슬러그가 정확히 "lookup"인
// 용어는 `GET /api/v1/terms/lookup`이 이 정적 라우트로 가로채여 상세 조회가
// 영원히 불가능해진다(그 라우트는 POST만 허용해 405가 나간다).
// slugify("Lookup") === "lookup"이라 이런 이름의 용어를 만드는 순간 조용히
// 발생한다 — 예약어는 uniqueSlug에서 "이미 사용 중"인 것처럼 취급해 피한다.
// R105: 손으로 유지되는 리터럴이라 라우트 파일시스템과 연결이 없다 — export해서
// "app/api/v1/terms/ 밑 정적 세그먼트가 전부 여기 있는가"를 구조 테스트로
// 잠근다(테스트: apps/web/tests/terms-lookup.test.ts).
//
// R92: "new"는 app/terms/ 밑 정적 세그먼트다(Task 13의 `/terms/new` 폼). Next는
// 정적 세그먼트를 동적 세그먼트(`app/terms/[slug]`)보다 먼저 매칭하므로,
// slugify("New") === "new"인 용어는 상세 페이지에 영원히 도달할 수 없고 대신
// "새 용어" 폼이 뜬다 — R86과 정확히 같은 결함이 한 마일스톤 뒤에 반복되는
// 것이다. uniqueSlug가 이미 사용 중인 것처럼 취급해 피한다.
export const RESERVED_SLUGS = new Set(["lookup", "new"]);

async function uniqueSlug(base: string): Promise<string> {
  const seed = base || "term";
  const existing = await getDb()
    .select({ slug: terms.slug })
    .from(terms)
    .where(like(terms.slug, `${seed}%`));

  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(seed) && !RESERVED_SLUGS.has(seed)) return seed;

  for (let n = 2; ; n += 1) {
    const candidate = `${seed}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// R56: 수정 경로(updateTerm)는 term 자신의 기존 표기까지 포함한 "파생 + 명시"
// 전체 집합을 넘겨 충돌을 검사한다. excludeTermId가 없으면(생성 경로) 걸러낼
// "자기 자신"이 아직 없으므로 동작이 그대로 유지된다.
export async function findDuplicates(
  surfaces: SurfaceInput[],
  excludeTermId?: string,
): Promise<DuplicateWarning[]> {
  const keys = surfaces.map((s) => surfaceKeys(s.text).normLoose).filter(Boolean);
  if (keys.length === 0) return [];

  const conditions = [inArray(termSurfaces.normLoose, keys)];
  if (excludeTermId) conditions.push(ne(termSurfaces.termId, excludeTermId));

  const rows = await getDb()
    .select({
      normLoose: termSurfaces.normLoose,
      text: termSurfaces.text,
      termId: termSurfaces.termId,
      slug: terms.slug,
    })
    .from(termSurfaces)
    .innerJoin(terms, eq(terms.id, termSurfaces.termId))
    .where(and(...conditions));

  return rows.map((r) => ({
    normLoose: r.normLoose,
    surfaceText: r.text,
    conflictingTermId: r.termId,
    conflictingSlug: r.slug,
  }));
}

// R48: postgres-js 에러 객체는 SQLSTATE를 `.code`로, 위반한 제약 이름을
// `.constraint_name`으로 싣는다(v3.4.9 connection.js 필드 매핑 확인). 슬러그
// 충돌(23505 on terms_slug_unique)만 재시도 대상이다 — term_surfaces_unique
// 같은 다른 23505는 실제 데이터 무결성 문제이므로 그대로 던져야 한다.
export function isSlugConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === "terms_slug_unique";
}

const MAX_SLUG_RETRIES = 3;

export async function createTerm(
  input: TermInput,
  authorId: string | null,
  authorKeyId: string | null = null,
) {
  const db = getDb();
  const surfaces = deriveSurfaces(input, input.surfaces);
  // R32: 중복 경고는 저장 결과에 영향을 주지 않는 읽기 전용 조회다. 원자적으로
  // 묶어야 하는 쓰기가 아니므로 트랜잭션 밖에서 수행한다.
  const warnings = await findDuplicates(surfaces);
  const base = slugify(input.nameEn ?? input.nameKo ?? "");

  // R48: uniqueSlug의 SELECT와 트랜잭션의 INSERT 사이에는 창이 있다. 그 창에서
  // 동시에 같은 슬러그를 계산한 다른 요청이 먼저 커밋하면 terms_slug_unique가
  // 23505를 던진다. 유령 term/term_surfaces/term_revisions를 하나도 남기지
  // 않고(트랜잭션이 통째로 롤백되므로) 슬러그만 다시 계산해 재시도한다.
  // 트랜잭션 "안"이 아니라 "밖"에서 재시도하는 이유: 실패한 트랜잭션은 이미
  // 롤백되어 재사용할 수 없고, uniqueSlug도 새 트랜잭션 밖에서 매번 새로
  // 커밋된 상태를 읽어야 다음 후보가 의미가 있다.
  for (let attempt = 1; ; attempt += 1) {
    const slug = await uniqueSlug(base);
    try {
      // R32: terms / term_surfaces / term_revisions 세 개의 insert를 하나의 트랜잭션으로
      // 묶는다. 이 셋을 독립된 statement로 실행하면 중간 실패 시 리비전이 0개인 term이나
      // 표기가 하나도 없는 term이 남을 수 있다. Task 10의 updateTerm은
      // revisionNumber = max + 1로 이력을 이어가므로, 리비전 0개인 행은 그 계산을 깬다.
      // 전체 위키 이력 보존이 이 제품의 핵심 약속이라 부분 저장은 허용하지 않는다.
      // (이 저장소에서 트랜잭션을 쓰는 첫 지점 — Task 10이 이 패턴을 그대로 따른다.)
      const { term, savedSurfaces } = await db.transaction(async (tx) => {
        const [insertedTerm] = await tx
          .insert(terms)
          .values({
            slug,
            termType: input.termType,
            nameEn: input.nameEn ?? null,
            nameKo: input.nameKo ?? null,
            fullNameEn: input.fullNameEn ?? null,
            fullNameKo: input.fullNameKo ?? null,
            domain: input.domain,
            status: input.status,
            definitionMd: input.definitionMd ?? null,
            // R33: terms.body_md를 채우는 유일한 쓰기 경로. schema.ts에 bodyMd 필드를
            // 추가한 이유가 이것이다 — 안 그러면 이 컬럼은 영원히 null로만 읽힌다.
            bodyMd: input.bodyMd ?? null,
            createdBy: authorId,
            updatedBy: authorId,
          })
          .returning();

        const savedSurfaces = surfaces.length
          ? await tx
              .insert(termSurfaces)
              .values(
                surfaces.map((s) => ({
                  termId: insertedTerm!.id,
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
          termId: insertedTerm!.id,
          revisionNumber: 1,
          snapshot: { term: insertedTerm, surfaces: savedSurfaces },
          message: "created",
          authorId,
          // R47: API 키로 만든 리비전은 authorId가 항상 null이라 누가 썼는지
          // 나중에 채울 방법이 없다 — 지금 기록해야 한다.
          authorKeyId,
        });

        return { term: insertedTerm!, savedSurfaces };
      });

      return { term, surfaces: savedSurfaces, warnings };
    } catch (err) {
      if (isSlugConflict(err) && attempt < MAX_SLUG_RETRIES) continue;
      throw err;
    }
  }
}
