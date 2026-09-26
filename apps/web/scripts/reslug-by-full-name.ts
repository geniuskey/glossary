import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, termSlugAliases, terms } from "@glossary/db";
import { pickSlug, slugify, slugSeed } from "../src/lib/terms/slug";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 컨테이너에서는 환경변수를 그대로 사용한다.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다.");
const db = createDb(databaseUrl);
const apply = process.argv.includes("--apply");

const [rows, retired] = await Promise.all([
  db.select({
    id: terms.id, slug: terms.slug, nameEn: terms.nameEn, nameKo: terms.nameKo,
    fullNameEn: terms.fullNameEn, domain: terms.domain, replacedById: terms.replacedById,
  }).from(terms).orderBy(terms.createdAt),
  db.select({ slug: termSlugAliases.slug }).from(termSlugAliases),
]);
const taken = new Set([...rows.map((row) => row.slug), ...retired.map((row) => row.slug)]);

// 예전 규칙(nameEn → 번호)이 만든 slug만 옮긴다. 사람이 직접 고친 slug는 의도가
// 있으니 건드리지 않는다. 병합된 용어는 대표 용어로 넘어가므로 주소를 바꿀 이유가 없다.
const targets = rows.flatMap((row) => {
  if (row.replacedById || !row.fullNameEn) return [];
  const legacy = slugify(row.nameEn ?? row.nameKo ?? "");
  if (!legacy || !new RegExp(`^${legacy}(-\\d+)?$`).test(row.slug)) return [];
  const seed = slugSeed(row);
  if (seed === legacy) return [];
  const next = pickSlug(seed, row.domain, (slug) => taken.has(slug));
  taken.add(next);
  return [{ id: row.id, from: row.slug, to: next }];
});

console.log(`${targets.length}개 용어 slug 변경 대상${apply ? "" : " (미적용, --apply로 적용)"}`);
for (const target of targets) console.log(`${target.from} -> ${target.to}`);
if (!apply) process.exit(0);

// slug는 내용이 아니라 주소라 리비전을 남기지 않는다(되돌리기도 slug를 복원하지
// 않는다). 리비전을 올리면 그 번호에 묶인 AI 검토 제안이 쓸데없이 무효가 된다.
for (const target of targets) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ slug: terms.slug }).from(terms).where(eq(terms.id, target.id)).for("no key update");
    if (current?.slug !== target.from) return;
    await tx.update(terms).set({ slug: target.to }).where(eq(terms.id, target.id));
    await tx.insert(termSlugAliases).values({ slug: target.from, termId: target.id }).onConflictDoNothing();
  });
}

console.log("적용 완료");
process.exit(0);
