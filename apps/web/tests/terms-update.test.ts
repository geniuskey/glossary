import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { apiKeys, createDb, terms, termRevisions, termSurfaces, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";
import { createTerm } from "../src/lib/terms/create.js";
import { deleteTerm, isRevisionConflict, listRevisions, updateTerm } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];
const createdUsers: string[] = [];
const createdKeys: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
  for (const id of createdUsers.splice(0)) await db.delete(users).where(eq(users.id, id));
  for (const id of createdKeys.splice(0)) await db.delete(apiKeys).where(eq(apiKeys.id, id));
});

async function seed() {
  const { term } = await createTerm(
    { termType: "term", nameEn: "Black Level", domain: ["ISP"], status: "draft", surfaces: [] },
    null,
  );
  created.push(term.id);
  return term;
}

function expectSaved<T extends { term: unknown }>(
  result:
    | T
    | { conflict: true; currentRevision: number }
    | { invalid: true; issues: string[] }
    | { notFound: true },
): T {
  if ("conflict" in result || "invalid" in result || "notFound" in result) {
    throw new Error(`예상치 못한 결과: ${JSON.stringify(result)}`);
  }
  return result;
}

test("수정하면 리비전이 하나 늘어난다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "블랙레벨", status: "approved" }, null);

  const revs = await listRevisions(term.id);
  expect(revs.map((r) => r.revisionNumber)).toEqual([2, 1]);
});

test("표기를 교체하면 이전 표기가 사라진다", async () => {
  const term = await seed();
  const result = expectSaved(
    await updateTerm(term.id, { surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] }, null),
  );

  expect(result.surfaces.map((s) => s.text).sort()).toEqual(["BLC", "Black Level"]);
});

test("기대 리비전이 어긋나면 충돌을 반환하고 저장하지 않는다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "블랙레벨" }, null);

  const stale = await updateTerm(term.id, { nameKo: "다른값" }, null, 1);
  expect(stale).toEqual({ conflict: true, currentRevision: 2 });

  const revs = await listRevisions(term.id);
  expect(revs).toHaveLength(2);

  // 충돌 응답은 저장 거부를 뜻한다 — nameKo가 실제로 안 바뀌었는지 직접 본다.
  const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row!.nameKo).toBe("블랙레벨");
});

test("삭제하면 리비전도 함께 사라진다", async () => {
  const term = await seed();
  await expect(deleteTerm(term.id)).resolves.toBe(true);
  await expect(listRevisions(term.id)).resolves.toEqual([]);
  created.length = 0;
});

// R51: surfaces 없이 patch하면 기존에 사용자가 직접 추가한 표기가 사라지면 안
// 된다. 브리프 원안(`input.surfaces ?? []` 후 delete-all-then-reinsert)은 이
// 경우 명시 표기를 통째로 지운다 — 그 결함을 직접 겨냥한 테스트.
test("surfaces 없이 patch하면 기존 명시 표기가 유지된다 (R51)", async () => {
  const term = await seed();
  const first = expectSaved(
    await updateTerm(term.id, { surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] }, null),
  );
  expect(first.surfaces.map((s) => s.text).sort()).toEqual(["BLC", "Black Level"]);

  const second = expectSaved(await updateTerm(term.id, { status: "approved" }, null));
  expect(second.surfaces.map((s) => s.text).sort()).toEqual(["BLC", "Black Level"]);
  expect(second.term.status).toBe("approved");
});

// R51: surfaces를 빈 배열로 명시하면(undefined가 아니라 [] 자체) 그건 "명시
// 표기를 전부 지운다"는 사용자의 의도다 — undefined와 []는 서로 다르게
// 취급해야 한다.
test("surfaces를 빈 배열로 명시하면 명시 표기가 지워진다 (R51)", async () => {
  const term = await seed();
  expectSaved(await updateTerm(term.id, { surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] }, null));

  const cleared = expectSaved(await updateTerm(term.id, { surfaces: [] }, null));
  expect(cleared.surfaces.map((s) => s.text)).toEqual(["Black Level"]);
});

// R52: patch의 최종 표기 집합(파생 + 명시)이 서로 모순되면 invalid를 반환하고
// 아무 것도 저장하지 않아야 한다. termInputSchema의 superRefine은 생성 시점에만
// 쓰이므로, updateTerm이 병합된 집합에 대해 checkSurfaceConflicts를 직접
// 호출하지 않으면 이 케이스는 조용히 저장된다.
test("병합된 표기가 서로 모순되면 invalid를 반환하고 저장하지 않는다 (R52)", async () => {
  const term = await seed();
  const result = await updateTerm(
    term.id,
    { surfaces: [{ text: "Black Level", lang: "en", kind: "forbidden" }] },
    null,
  );

  expect("invalid" in result).toBe(true);
  if ("invalid" in result) expect(result.issues.length).toBeGreaterThan(0);

  const revs = await listRevisions(term.id);
  expect(revs).toHaveLength(1);

  const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
  expect(surfaces.map((s) => s.kind)).not.toContain("forbidden");
});

// R53: terms UPDATE / term_surfaces 교체 / term_revisions insert가 하나의
// 트랜잭션이어야 한다. 리비전 insert만 실패시켜서(NOT VALID CHECK) 앞서 실행된
// terms UPDATE와 term_surfaces 교체까지 함께 롤백되는지 직접 확인한다 —
// create.ts의 R32 테스트와 동일한 기법.
test("트랜잭션 중간(리비전 insert)이 실패하면 term/표기 모두 이전 상태로 남는다 (R53)", async () => {
  const term = await seed();
  await db.execute(
    sql`ALTER TABLE term_revisions ADD CONSTRAINT rollback_probe_update_check CHECK (message <> 'updated') NOT VALID`,
  );
  try {
    await expect(updateTerm(term.id, { nameKo: "블랙레벨", surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] }, null)).rejects.toThrow();

    const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
    expect(row!.nameKo).toBeNull();

    const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
    expect(surfaces.map((s) => s.text)).toEqual(["Black Level"]);

    const revs = await listRevisions(term.id);
    expect(revs).toHaveLength(1);
  } finally {
    await db.execute(sql`ALTER TABLE term_revisions DROP CONSTRAINT rollback_probe_update_check`);
  }
});

// R54: 두 요청이 같은 currentRevision을 읽고 동시에 revisionNumber+1을 insert하면
// term_revisions_unique가 23505를 던진다. READ COMMITTED로는 막을 수 없는
// 경합이므로, updateTerm은 나중에 커밋을 시도하는 쪽에게 409를 돌려줘야 한다.
// create.ts의 "슬러그 경합" 테스트와 같은 기법: 블로커 트랜잭션이 같은
// revisionNumber를 먼저 커밋 대기 상태로 잡아 둔다.
test("리비전 번호가 경합하면 409로 변환되고 저장되지 않는다 (R54)", async () => {
  const term = await seed();

  let signalInserted!: () => void;
  const inserted = new Promise<void>((resolve) => {
    signalInserted = resolve;
  });
  let releaseBlocker!: () => void;
  const blockerReleased = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });

  const blockerTx = db.transaction(async (tx) => {
    await tx.insert(termRevisions).values({
      termId: term.id,
      revisionNumber: 2,
      snapshot: { blocker: true },
      message: "blocker",
      authorId: null,
    });
    signalInserted();
    await blockerReleased;
  });

  await inserted;

  const updatePromise = updateTerm(term.id, { nameKo: "블랙레벨" }, null);

  await new Promise((resolve) => setTimeout(resolve, 200));
  releaseBlocker();
  await blockerTx;

  const result = await updatePromise;
  expect(result).toEqual({ conflict: true, currentRevision: 2 });

  const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row!.nameKo).toBeNull();
});

test("isRevisionConflict은 term_revisions_unique 위반만 참으로 판별한다 (R54)", () => {
  expect(isRevisionConflict({ code: "23505", constraint_name: "term_revisions_unique" })).toBe(true);
  expect(isRevisionConflict({ code: "23505", constraint_name: "terms_slug_unique" })).toBe(false);
  expect(isRevisionConflict({ code: "23503", constraint_name: "term_revisions_unique" })).toBe(false);
  expect(isRevisionConflict(new Error("boom"))).toBe(false);
  expect(isRevisionConflict(null)).toBe(false);
});

// R55: bodyMd가 patch로 채워져야 한다(브리프 원안은 .set()에서 빠뜨림).
test("bodyMd가 patch로 저장된다 (R55)", async () => {
  const term = await seed();
  const bodyMd = "# 갱신된 본문";
  const result = expectSaved(await updateTerm(term.id, { bodyMd }, null));
  expect(result.term.bodyMd).toBe(bodyMd);

  const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row!.bodyMd).toBe(bodyMd);
});

// R55: API 키로 patch해도 이전에 실제 사용자가 남긴 updatedBy를 null로 지우면
// 안 된다. 그 편집의 실제 주체는 authorKeyId로 term_revisions에 남아야 한다.
test("API 키로 patch해도 updatedBy가 지워지지 않고 authorKeyId가 기록된다 (R55)", async () => {
  const term = await seed();

  const [user] = await db
    .insert(users)
    .values({
      email: `terms-update-r55-${Date.now()}@example.com`,
      name: "R55 테스트 사용자",
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  createdUsers.push(user!.id);

  const [key] = await db
    .insert(apiKeys)
    .values({ name: "R55 테스트 키", prefix: `r55${Date.now()}`.slice(0, 12), keyHash: "irrelevant-hash", scopes: ["write"] })
    .returning();
  createdKeys.push(key!.id);

  // 1) 실제 사용자로 먼저 수정 -> updatedBy = user.id
  expectSaved(await updateTerm(term.id, { nameKo: "블랙레벨" }, user!.id));
  const [afterUser] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(afterUser!.updatedBy).toBe(user!.id);

  // 2) API 키로 수정 -> authorId는 null이지만 updatedBy는 그대로 남아야 한다
  const apiResult = expectSaved(await updateTerm(term.id, { nameKo: "블랙레벨2" }, null, undefined, key!.id));
  expect(apiResult.term.updatedBy).toBe(user!.id);

  const [afterKey] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(afterKey!.updatedBy).toBe(user!.id);

  const revs = await db.select().from(termRevisions).where(eq(termRevisions.termId, term.id)).orderBy(termRevisions.revisionNumber);
  // revs[0]=생성(1), revs[1]=사용자 patch(2), revs[2]=API 키 patch(3)
  expect(revs[2]!.authorKeyId).toBe(key!.id);
  expect(revs[2]!.authorId).toBeNull();
});

// R56: 수정 대상 term 자신의 기존 표기와는 충돌 경고가 나면 안 된다. 브리프
// 원안대로 findDuplicates(surfaces)를 excludeTermId 없이 호출하면, "Black
// Level" 표기를 유지한 채 다른 필드만 patch해도 자기 자신에 대한 경고가
// 매번 뜬다.
test("자기 자신의 기존 표기와는 중복 경고가 나지 않는다 (R56)", async () => {
  const term = await seed();
  const result = expectSaved(await updateTerm(term.id, { status: "approved" }, null));

  const selfWarnings = result.warnings.filter((w) => w.conflictingTermId === term.id);
  expect(selfWarnings).toHaveLength(0);
});

test("다른 term과 표기가 겹치면 여전히 경고가 뜬다 (R56)", async () => {
  const term = await seed();
  const other = await createTerm(
    { termType: "term", nameEn: "Update Dup Probe", domain: [], status: "draft", surfaces: [] },
    null,
  );
  created.push(other.term.id);

  const result = expectSaved(
    await updateTerm(term.id, { surfaces: [{ text: "Update Dup Probe", lang: "en", kind: "alias" }] }, null),
  );
  const warningsForOther = result.warnings.filter((w) => w.conflictingTermId === other.term.id);
  expect(warningsForOther).toHaveLength(1);
});
