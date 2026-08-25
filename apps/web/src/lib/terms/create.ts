import { eq, inArray, like } from "drizzle-orm";
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

async function uniqueSlug(base: string): Promise<string> {
  const seed = base || "term";
  const existing = await getDb()
    .select({ slug: terms.slug })
    .from(terms)
    .where(like(terms.slug, `${seed}%`));

  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(seed)) return seed;

  for (let n = 2; ; n += 1) {
    const candidate = `${seed}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function findDuplicates(surfaces: SurfaceInput[]): Promise<DuplicateWarning[]> {
  const keys = surfaces.map((s) => surfaceKeys(s.text).normLoose).filter(Boolean);
  if (keys.length === 0) return [];

  const rows = await getDb()
    .select({
      normLoose: termSurfaces.normLoose,
      text: termSurfaces.text,
      termId: termSurfaces.termId,
      slug: terms.slug,
    })
    .from(termSurfaces)
    .innerJoin(terms, eq(terms.id, termSurfaces.termId))
    .where(inArray(termSurfaces.normLoose, keys));

  return rows.map((r) => ({
    normLoose: r.normLoose,
    surfaceText: r.text,
    conflictingTermId: r.termId,
    conflictingSlug: r.slug,
  }));
}

export async function createTerm(input: TermInput, authorId: string | null) {
  const db = getDb();
  const surfaces = deriveSurfaces(input, input.surfaces);
  // R32: 중복 경고는 저장 결과에 영향을 주지 않는 읽기 전용 조회다. 원자적으로
  // 묶어야 하는 쓰기가 아니므로 트랜잭션 밖에서 수행한다.
  const warnings = await findDuplicates(surfaces);
  const slug = await uniqueSlug(slugify(input.nameEn ?? input.nameKo ?? ""));

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
    });

    return { term: insertedTerm!, savedSurfaces };
  });

  return { term, surfaces: savedSurfaces, warnings };
}
