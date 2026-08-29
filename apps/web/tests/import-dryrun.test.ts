import { eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { apiKeys, createDb, terms, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createTerm } from "../src/lib/terms/create.js";
import { listRevisions } from "../src/lib/terms/update.js";
import { applyImport, dryRunImport } from "../src/lib/import/apply.js";
import type { ImportRow } from "../src/lib/import/parse-xlsx.js";

// R116/api-key.test.ts와 같은 확립된 패턴: tests/setup.ts가 DATABASE_URL을
// DATABASE_URL_TEST로 덮어쓰므로, process.env.DATABASE_URL을 직접 읽어도
// 테스트 DB에 붙는다. createTerm/findDuplicates(lib/terms/create.ts)도
// getDb()를 통해 같은 값을 읽는다 — 별도 URL을 쓸 이유가 없다.
const db = createDb(process.env.DATABASE_URL!);

const createdTermIds: string[] = [];
const createdUsers: string[] = [];
const createdKeys: string[] = [];

// 이 파일이 만드는 term은 전부 "ID14 "로 시작하는 nameEn을 쓴다. applyImport가
// 실제로 몇 개의 term을 만들었는지 뒤에서 이 접두어로 다시 조회해 트랙한다
// (ApplyResult는 생성된 term의 id/slug를 돌려주지 않는다 — 계획서 스케치의
// 반환 타입 `{ created: number }` 그대로다).
const NAME_PREFIX = "ID14 ";

function row(rowNumber: number, nameEn: string, aliases: string[] = []): ImportRow {
  return { rowNumber, termType: "term", nameEn, domain: [], status: "active", aliases };
}

async function trackAllByPrefix() {
  const rows = await db.select({ id: terms.id }).from(terms).where(like(terms.nameEn, `${NAME_PREFIX}%`));
  for (const r of rows) if (!createdTermIds.includes(r.id)) createdTermIds.push(r.id);
}

let seedTermId = "";
let seedSlug = "";

beforeAll(async () => {
  const { term } = await createTerm(
    { termType: "term", nameEn: `${NAME_PREFIX}Lens Shading`, domain: ["ISP"], status: "active", surfaces: [] },
    null,
  );
  seedTermId = term.id;
  seedSlug = term.slug;
  createdTermIds.push(term.id);
});

afterEach(async () => {
  // 시드 term은 남기고, 이번 테스트가 새로 만든 term만 정리한다.
  await trackAllByPrefix();
  const toDelete = createdTermIds.filter((id) => id !== seedTermId);
  if (toDelete.length > 0) await db.delete(terms).where(inArray(terms.id, toDelete));
  createdTermIds.length = 0;
  createdTermIds.push(seedTermId);
});

afterAll(async () => {
  if (seedTermId) await db.delete(terms).where(eq(terms.id, seedTermId));
  for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
  for (const id of createdKeys.splice(0)) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

// --- 계획서 스케치의 dry-run 테스트(어댑트: conflictingSlug -> conflictingSlugs[]) ---

test("이미 등록된 표기와 겹치는 행을 conflicts에 담는다", async () => {
  const report = await dryRunImport([row(2, seedSlug.replace(/-/g, " "))], []);

  expect(report.conflicts).toHaveLength(1);
  expect(report.conflicts[0]).toMatchObject({ rowNumber: 2 });
  expect(report.conflicts[0]!.conflictingSlugs).toContain(seedSlug);
});

test("파일 안에서 중복된 표기를 행 번호와 함께 보고한다", async () => {
  const report = await dryRunImport([row(2, `${NAME_PREFIX}Dead Pixel`), row(3, `${NAME_PREFIX.toLowerCase()}dead-pixel`)], []);

  const dup = report.duplicatesInFile.find((d) => d.rowNumbers.includes(2) && d.rowNumbers.includes(3));
  expect(dup?.rowNumbers).toEqual([2, 3]);
});

test("별칭이 기존 용어와 겹쳐도 잡아낸다", async () => {
  const report = await dryRunImport([row(2, `${NAME_PREFIX}Vignetting`, [`${NAME_PREFIX}Lens Shading`])], []);

  expect(report.conflicts.map((c) => c.rowNumber)).toContain(2);
});

test("total은 파싱 실패 행까지 세고 ready는 세지 않는다", async () => {
  const report = await dryRunImport([row(2, `${NAME_PREFIX}Gain`)], [{ rowNumber: 3, message: "표기 없음" }]);

  expect(report).toMatchObject({ total: 2, ready: 1 });
  expect(report.errors).toHaveLength(1);
});

// --- R117: 반영(applyImport)은 dry-run 결과를 신뢰하지 않고 스스로 판정을 다시 계산한다 ---

test("R117: 기존 용어와 충돌하는 행은 기본적으로 건너뛰고 DB에 새 term을 만들지 않는다", async () => {
  const [before] = await db.select({ n: terms.id }).from(terms).where(eq(terms.slug, seedSlug));
  expect(before).toBeDefined();

  const result = await applyImport([row(2, seedSlug.replace(/-/g, " "))], null, null);

  expect(result.created).toBe(0);
  expect(result.skipped).toEqual([{ rowNumber: 2, reason: "conflict" }]);

  // 리포트만 확인하는 건 부족하다 — 실제 DB에 같은 이름의 term이 하나 더
  // 생기지 않았는지 직접 센다.
  const rowsAfter = await db.select({ id: terms.id }).from(terms).where(eq(terms.slug, seedSlug));
  expect(rowsAfter).toHaveLength(1);
});

test("R117: force로 명시한 행은 충돌해도 동음이의어로 그대로 등록된다", async () => {
  const rowNumber = 2;
  const result = await applyImport(
    [row(rowNumber, seedSlug.replace(/-/g, " "))],
    null,
    null,
    new Set([rowNumber]),
  );

  expect(result.created).toBe(1);
  expect(result.skipped).toEqual([]);

  const matches = await db.select({ id: terms.id }).from(terms).where(like(terms.nameEn, `${seedSlug.replace(/-/g, " ")}%`));
  expect(matches.length).toBeGreaterThanOrEqual(1);
  for (const m of matches) if (!createdTermIds.includes(m.id)) createdTermIds.push(m.id);
});

test("R117: 파일 내 중복 행도 기본적으로 건너뛴다(duplicate_in_file)", async () => {
  const result = await applyImport(
    [row(2, `${NAME_PREFIX}Dead Pixel`), row(3, `${NAME_PREFIX.toLowerCase()}dead-pixel`)],
    null,
    null,
  );

  expect(result.created).toBe(0);
  expect(result.skipped.sort((a, b) => a.rowNumber - b.rowNumber)).toEqual([
    { rowNumber: 2, reason: "duplicate_in_file" },
    { rowNumber: 3, reason: "duplicate_in_file" },
  ]);
});

// --- R120: API 키로 임포트해도 리비전에 작성자가 남는다 ---

test("R120: 사용자 세션으로 반영하면 리비전 authorId가 사용자 id다", async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `import-r120-user-${Date.now()}@example.com`,
      name: "R120 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  createdUsers.push(user!.id);

  const nameEn = `${NAME_PREFIX}User Authored`;
  const result = await applyImport([row(2, nameEn)], user!.id, null);
  expect(result.created).toBe(1);

  const [term] = await db.select().from(terms).where(eq(terms.nameEn, nameEn));
  expect(term).toBeDefined();

  const revs = await listRevisions(term!.id);
  expect(revs[0]!.authorId).toBe(user!.id);
  expect(revs[0]!.authorKeyId).toBeNull();
});

test("R120: API 키로 반영하면 리비전 authorKeyId가 키 id고 authorId는 null이다", async () => {
  const [key] = await db
    .insert(apiKeys)
    .values({ name: "R120 테스트 키", prefix: `r120${Date.now()}`.slice(0, 12), keyHash: "irrelevant-hash", scopes: ["write"] })
    .returning();
  createdKeys.push(key!.id);

  const nameEn = `${NAME_PREFIX}Key Authored`;
  const result = await applyImport([row(2, nameEn)], null, key!.id);
  expect(result.created).toBe(1);

  const [term] = await db.select().from(terms).where(eq(terms.nameEn, nameEn));
  expect(term).toBeDefined();

  const revs = await listRevisions(term!.id);
  expect(revs[0]!.authorKeyId).toBe(key!.id);
  expect(revs[0]!.authorId).toBeNull();
});
