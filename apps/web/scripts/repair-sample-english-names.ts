import path from "node:path";
import { and, eq, like, or, sql } from "drizzle-orm";
import { aiReviewSuggestions, createDb, surfaceKeys, termRevisions, termSurfaces, terms } from "@glossary/db";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 컨테이너에서는 환경변수를 그대로 사용한다.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다.");
const db = createDb(databaseUrl);
const apply = process.argv.includes("--apply");

const rows = await db.select().from(terms).where(or(
  like(terms.slug, "definition-sample-%"),
  like(terms.slug, "review-sample-%"),
));

const targets = rows.filter((row) => {
  const definition = /^definition-sample-(?:[1-9]|1\d|20)$/.test(row.slug)
    && row.nameKo?.startsWith("정의 샘플 · ");
  const review = /^review-sample-(?:[1-9]|[12]\d|30)$/.test(row.slug)
    && row.nameKo?.startsWith("검토 샘플 · ");
  return (definition || review) && (
    (!row.nameEn && Boolean(row.fullNameEn))
    || (row.slug === "review-sample-5" && row.nameEn === "CQRS" && !row.fullNameEn)
  );
});

console.log(`${targets.length}개 샘플 용어 수정 대상${apply ? "" : " (미적용)"}`);
if (!apply) {
  for (const row of targets) console.log(`${row.slug}: ${row.fullNameEn}`);
  process.exit(0);
}

for (const row of targets) {
  const englishName = row.fullNameEn ?? row.nameEn!;
  const isEtl = row.slug === "definition-sample-5";
  const isCqrs = row.slug === "review-sample-5";
  const nameEn = isEtl ? "ETL" : englishName;
  const fullNameEn = isEtl ? englishName
    : isCqrs ? "Command Query Responsibility Segregation" : null;
  const kind = isEtl || isCqrs ? "abbreviation" as const : "canonical" as const;

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(terms).where(eq(terms.id, row.id)).for("no key update");
    if (!current || current.nameEn !== row.nameEn || current.fullNameEn !== row.fullNameEn) return;

    const [updated] = await tx.update(terms).set({ nameEn, fullNameEn, updatedAt: new Date() })
      .where(eq(terms.id, row.id)).returning();
    if (!updated) return;

    if (!isEtl && row.fullNameEn) {
      await tx.delete(termSurfaces).where(and(
        eq(termSurfaces.termId, row.id),
        eq(termSurfaces.kind, "full_name"),
        eq(termSurfaces.normLoose, surfaceKeys(englishName).normLoose),
      ));
    }
    await tx.insert(termSurfaces).values({
      termId: row.id,
      text: nameEn,
      lang: "en",
      kind,
      caseSensitive: kind === "abbreviation",
      ...surfaceKeys(nameEn),
    }).onConflictDoNothing();
    if (fullNameEn && fullNameEn !== row.fullNameEn) {
      await tx.insert(termSurfaces).values({
        termId: row.id,
        text: fullNameEn,
        lang: "en",
        kind: "full_name",
        caseSensitive: false,
        ...surfaceKeys(fullNameEn),
      }).onConflictDoNothing();
    }

    const savedSurfaces = await tx.select().from(termSurfaces).where(eq(termSurfaces.termId, row.id));
    const [latest] = await tx.select({ revision: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
      .from(termRevisions).where(eq(termRevisions.termId, row.id));
    const nextRevision = (latest?.revision ?? 0) + 1;
    await tx.insert(termRevisions).values({
      termId: row.id,
      revisionNumber: nextRevision,
      snapshot: { term: updated, surfaces: savedSurfaces },
      message: "샘플 영문 표기 필드 수정",
    });
    if (row.slug.startsWith("review-sample-")) {
      await tx.update(aiReviewSuggestions).set({ revision: nextRevision })
        .where(eq(aiReviewSuggestions.termId, row.id));
    }
  });
}

console.log("샘플 영문 표기 수정 완료");
process.exit(0);
