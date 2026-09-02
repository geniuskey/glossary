import { and, eq, inArray, like, ne } from "drizzle-orm";
import {
  attachmentRefs, attachments, surfaceKeys, terms, termRevisions, termSurfaces,
} from "@grossary/db";
import { isUuid } from "@/lib/api-error";
import { extractAttachmentHashes } from "@/lib/attachments/refs";
import { getDb } from "@/lib/db";
import { RESERVED_SLUGS, slugify } from "./slug";
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
// R92: "new"는 원래 app/terms/ 밑 정적 세그먼트였다(`/terms/new` 폼). Next는
// 정적 세그먼트를 동적 세그먼트(`app/terms/[slug]`)보다 먼저 매칭하므로,
// slugify("New") === "new"인 용어는 상세 페이지에 영원히 도달할 수 없고 대신
// "새 용어" 폼이 떴다 — R86과 정확히 같은 결함이 한 마일스톤 뒤에 반복된 것이다.
//
// R135: 화면 주소가 `/w/<slug>`로 옮겨가면서 그 충돌 자체는 사라졌다(슬러그가
// 사는 곳에는 이제 정적 형제가 없다). 그래도 "new"는 예약어로 남긴다 —
// next.config.ts의 `/terms/new → /new` 리다이렉트가 파일시스템보다 먼저
// 검사되므로, 슬러그가 "new"인 용어의 **옛 링크**(`/terms/new`)는 상세 화면이
// 아니라 생성 폼으로 간다. 끊긴 링크를 살리려고 둔 장치가 도로 같은 종류의
// 조용한 도달 불가를 만드는 셈이라, 그 슬러그는 계속 피한다.
// R136: "suggest"도 같은 이유로 추가한다 — `GET /api/v1/terms/suggest`(자동완성)가
// `terms/[idOrSlug]`보다 먼저 매칭되므로, 슬러그가 "suggest"인 용어는 상세 조회가
// 영원히 자동완성 응답으로 대체된다.
export { RESERVED_SLUGS } from "./slug";

// F2(수정 라운드, R86/R92와 같은 계열): slugify는 하이픈과 16진 문자를 모두
// 보존하므로 "550e8400 e29b 41d4 a716 446655440000" 같은 이름이 UUID 모양
// slug("550e8400-e29b-41d4-a716-446655440000")를 만들 수 있다.
// getTermByIdOrSlug(query.ts)는 isUuid(idOrSlug)면 id로만 조회하므로, 그런
// slug는 자기 자신으로는 절대 조회되지 않는다 — 목록 화면은 그 slug로 링크를
// 렌더하는데 클릭하면 404가 되는, R92와 같은 형태의 조용한 도달 불가다.
// RESERVED_SLUGS와 같은 자리에서 "이미 사용 중"으로 취급해 접미사를 붙인다.
async function uniqueSlug(base: string): Promise<string> {
  const seed = base || "term";
  const existing = await getDb()
    .select({ slug: terms.slug })
    .from(terms)
    .where(like(terms.slug, `${seed}%`));

  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(seed) && !RESERVED_SLUGS.has(seed) && !isUuid(seed)) return seed;

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

export type RepresentativeField = "nameEn" | "nameKo";

export interface RepresentativeDuplicate {
  field: RepresentativeField;
  text: string;
  matches: DuplicateWarning[];
}

/**
 * 새 용어의 대표 영문·국문 표기가 기존의 어떤 검색 표기와 겹치는지 찾는다.
 * 대표명끼리만 비교하면 기존 약어를 새 대표명으로 다시 등록할 수 있어 검색 결과가
 * 둘로 갈라지므로, 대상은 term_surfaces의 전체 승인·비승인 표기다.
 */
export async function findRepresentativeDuplicates(
  input: Pick<TermInput, "nameEn" | "nameKo">,
  excludeTermId?: string,
): Promise<RepresentativeDuplicate[]> {
  const representatives = (["nameEn", "nameKo"] as const)
    .map((field) => ({ field, text: input[field]?.trim() ?? "" }))
    .filter((entry) => entry.text.length > 0);
  const warnings = await findDuplicates(
    representatives.map(({ text }) => ({ text, lang: "neutral", kind: "canonical" })),
    excludeTermId,
  );

  return representatives.flatMap(({ field, text }) => {
    const key = surfaceKeys(text).normLoose;
    const uniqueMatches = new Map(
      warnings.filter((warning) => warning.normLoose === key).map((warning) => [warning.conflictingTermId, warning]),
    );
    return uniqueMatches.size > 0 ? [{ field, text, matches: [...uniqueMatches.values()] }] : [];
  });
}

export function representativeDuplicateFieldErrors(
  duplicates: readonly RepresentativeDuplicate[],
): Partial<Record<RepresentativeField, string[]>> {
  const fieldErrors: Partial<Record<RepresentativeField, string[]>> = {};
  for (const duplicate of duplicates) {
    fieldErrors[duplicate.field] = duplicate.matches.map(
      (match) => `"${duplicate.text}" 표기가 기존 용어 ${match.conflictingSlug}에 이미 등록되어 있습니다.`,
    );
  }
  return fieldErrors;
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
  const attachmentHashes = extractAttachmentHashes(input.bodyMd);
  const attachmentRows = attachmentHashes.length
    ? await db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.sha256, attachmentHashes))
    : [];

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
            category: input.category ?? [],
            topic: input.topic ?? null,
            ownerId: input.ownerId ?? null,
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

        if (attachmentRows.length > 0) {
          await tx.insert(attachmentRefs).values(
            attachmentRows.map((attachment) => ({ attachmentId: attachment.id, termId: insertedTerm!.id })),
          );
        }

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
