import path from "node:path";
import { eq } from "drizzle-orm";
import { users } from "@grossary/db";
import { getDb } from "../src/lib/db.js";
import { SEED_PACKS, packByKey, type SeedPack } from "../src/lib/seed/glossaries.js";
import { createTerm, findDuplicates } from "../src/lib/terms/create.js";
import { termInputSchema } from "../src/lib/terms/schema.js";
import { deriveSurfaces } from "../src/lib/terms/surfaces.js";

// next.config.ts와 같은 이유·같은 방식으로 루트 .env를 읽는다. 이 스크립트는
// next를 거치지 않고 tsx로 바로 도니 아무도 대신 읽어 주지 않는다. import가
// 먼저 평가되지만 getDb()는 첫 호출 때 DATABASE_URL을 보므로 늦지 않다.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 파일이 없으면(운영·CI) 컨테이너/셸 환경변수를 그대로 쓴다.
}

function usage(): never {
  console.error("usage: tsx scripts/seed-terms.ts <pack...|all>");
  console.error("");
  console.error("묶음:");
  for (const pack of SEED_PACKS) {
    console.error(`  ${pack.key.padEnd(14)} ${pack.label} (${pack.terms.length}개) — ${pack.summary}`);
  }
  console.error(`  ${"all".padEnd(14)} 위 전부`);
  process.exit(1);
}

function resolvePack(key: string): SeedPack {
  const pack = packByKey(key);
  if (!pack) {
    console.error(`알 수 없는 묶음입니다: ${key}`);
    console.error("");
    usage();
  }
  return pack;
}

const args = process.argv.slice(2);
if (args.length === 0) usage();
const selected = args.includes("all") ? [...SEED_PACKS] : args.map(resolvePack);

// 씨앗 용어의 작성자는 첫 관리자로 둔다. 이력 화면에 "누가 만들었나"가 비는
// 것보다 낫다. 관리자가 아직 없으면(seed-admin 전에 실행) null로 남긴다 —
// createTerm이 허용하는 값이다.
async function seedAuthorId(): Promise<string | null> {
  const [admin] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(users.createdAt)
    .limit(1);
  return admin?.id ?? null;
}

const authorId = await seedAuthorId();
if (!authorId) console.log("관리자 계정이 없어 작성자 없이 추가합니다.");

let totalAdded = 0;
let totalSkipped = 0;

for (const pack of selected) {
  let added = 0;
  let skipped = 0;

  for (const seed of pack.terms) {
    const input = termInputSchema.parse({
      termType: seed.termType ?? "term",
      nameEn: seed.nameEn ?? null,
      nameKo: seed.nameKo ?? null,
      fullNameEn: seed.fullNameEn ?? null,
      fullNameKo: seed.fullNameKo ?? null,
      domain: [...pack.domain],
      // 완결된 예시라 승인 상태로 넣는다. draft로 넣으면 켜자마자 검토 대기
      // 줄이 아흔 개로 시작해 진짜 검토할 것이 그 밑에 묻힌다.
      status: "approved",
      definitionMd: seed.definitionMd,
      surfaces: (seed.aliases ?? []).map((text) => ({ text, kind: "alias" })),
    });

    // 같은 표기가 이미 있으면 건너뛴다 — 이 명령을 두 번 쳐도, 사용자가 이미
    // 손으로 넣어 둔 용어와 겹쳐도 사본이 생기지 않는다.
    const dupes = await findDuplicates(deriveSurfaces(input, input.surfaces));
    if (dupes.length > 0) {
      skipped += 1;
      continue;
    }

    await createTerm(input, authorId);
    added += 1;
  }

  console.log(`${pack.label}: ${added}개 추가, ${skipped}개 건너뜀`);
  totalAdded += added;
  totalSkipped += skipped;
}

if (selected.length > 1) console.log(`합계: ${totalAdded}개 추가, ${totalSkipped}개 건너뜀`);
process.exit(0);
