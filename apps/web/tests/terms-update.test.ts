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

// ----- Fix round 1 -----

// R70(F2)b: derivedFromOld/derivedKeys의 분류 키는 `normLoose:kind`여야 한다.
// `:${kind}`를 떼면(P16), normLoose만 같은 명시 alias가 파생 canonical과 같은
// 키로 묶여 "파생"으로 오분류되고, surfaces 없이 patch할 때 explicitSurfaces에서
// 조용히 빠진다 — 저장된 표기가 실제로 파괴된다.
test("normLoose가 같아도 kind가 다른 명시 표기는 파생 표기와 구별된다 (R70b)", async () => {
  const term = await seed(); // nameEn: "Black Level" -> derived canonical normLoose="blacklevel"
  const withAlias = expectSaved(
    await updateTerm(term.id, { surfaces: [{ text: "Black Level", lang: "en", kind: "alias" }] }, null),
  );
  expect(withAlias.surfaces.map((s) => s.kind).sort()).toEqual(["alias", "canonical"]);

  const statusOnly = expectSaved(await updateTerm(term.id, { status: "approved" }, null));
  expect(statusOnly.surfaces.map((s) => s.kind).sort()).toEqual(["alias", "canonical"]);
});

// R71(F3): 이름을 바꾸면 옛 이름의 파생 표기는 사라지고 새 이름의 표기만 남아야
// 한다. deriveSurfaces(mergedNames,...)를 deriveSurfaces(oldTerm,...)로 바꾸면(P4)
// 옛 이름만 남고, derivedFromOld를 oldTerm 대신 병합/새 이름으로 계산하면(P22)
// 옛 이름 행이 "명시 표기"로 오분류되어 새 이름과 함께 영원히 누적된다.
test("이름을 바꾸면 이전 이름의 표기는 사라지고 새 이름의 표기만 남는다 (R71)", async () => {
  const term = await seed();
  const renamed = expectSaved(await updateTerm(term.id, { nameEn: "White Level" }, null));
  expect(renamed.surfaces.map((s) => s.text)).toEqual(["White Level"]);

  const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
  expect(surfaces.map((s) => s.text)).toEqual(["White Level"]);
});

// R73(F5): term_revisions.snapshot에 실제 term/surfaces 내용이 담겨야 한다.
// create.ts에는 이 실패 양상을 이름 붙인 주석이 있는데 update 쪽은 스냅샷
// 내용을 전혀 단언하지 않아 `snapshot: {}`도 그린이었다.
test("리비전 스냅샷에 실제 term/surfaces 내용이 담긴다 (R73)", async () => {
  const term = await seed();
  expectSaved(
    await updateTerm(
      term.id,
      { nameKo: "블랙레벨", surfaces: [{ text: "BLC", lang: "en", kind: "alias" }] },
      null,
    ),
  );

  const revs = await db
    .select()
    .from(termRevisions)
    .where(eq(termRevisions.termId, term.id))
    .orderBy(termRevisions.revisionNumber);
  const snapshot = revs[1]!.snapshot as { term?: { nameKo?: string }; surfaces?: { text: string }[] };
  expect(snapshot.term?.nameKo).toBe("블랙레벨");
  // nameKo를 채우면 파생 canonical 표기가 하나 더 생긴다(en canonical + ko
  // canonical + 명시 alias) — 셋 다 스냅샷에 실제로 담겨야 한다.
  expect(snapshot.surfaces?.map((s) => s.text).sort()).toEqual(["BLC", "Black Level", "블랙레벨"]);
});

// R74(F6): R56의 나머지 절반 — 이름 변경으로 새로 생기는 표기도 findDuplicates에
// 전달된 최종 집합(nextSurfaces)에 포함되어야 경고가 뜬다. findDuplicates가
// explicitSurfaces만 받거나(P21) nextSurfaces가 옛 이름으로 계산되면(P4) 이
// 경고가 조용히 사라진다.
test("이름을 바꿔서 다른 term과 겹쳐도 중복 경고가 뜬다 (R74)", async () => {
  const term = await seed();
  const other = await createTerm(
    { termType: "term", nameEn: "Rename Dup Probe", domain: [], status: "draft", surfaces: [] },
    null,
  );
  created.push(other.term.id);

  const result = expectSaved(await updateTerm(term.id, { nameEn: "Rename Dup Probe" }, null));
  const warningsForOther = result.warnings.filter((w) => w.conflictingTermId === other.term.id);
  expect(warningsForOther).toHaveLength(1);
});

// R75(F7): 존재하지 않는 termId로 호출되는 건 레이스와 무관하게 도달 가능한
// 정상 상태다(export된 함수를 Task 13이 오래된 id로 부를 수 있다) — 맨 Error를
// 던지지 않고 판별 유니온으로 알려야 한다.
test("존재하지 않는 termId로 호출하면 notFound를 반환한다 (R75)", async () => {
  const result = await updateTerm("00000000-0000-0000-0000-000000000000", { nameKo: "x" }, null);
  expect(result).toEqual({ notFound: true });
});

// R76(F8): deleteTerm의 불리언 반환값은 소비자가 아직 없어도 계약이다 — 이미
// 지워진 termId로 다시 호출하면 false여야 한다(0행 삭제).
test("이미 지워진 termId로 다시 delete하면 false를 반환한다 (R76)", async () => {
  const term = await seed();
  await expect(deleteTerm(term.id)).resolves.toBe(true);
  await expect(deleteTerm(term.id)).resolves.toBe(false);
  created.length = 0;
});

// R79(F11): listRevisions/RevisionRow가 authorKeyId를 노출해야 한다. R47이 그
// 컬럼을 추가한 이유가 API 키 작성 리비전의 행위자 복원이었는데, 유일한 조회
// 경로가 숨기면 컬럼을 남긴 이유가 없어진다.
test("listRevisions 결과에 API 키 리비전의 author_key_id가 포함된다 (R79)", async () => {
  const term = await seed();
  const [key] = await db
    .insert(apiKeys)
    .values({
      name: "R79 테스트 키",
      prefix: `r79${Date.now()}`.slice(0, 12),
      keyHash: "irrelevant-hash",
      scopes: ["write"],
    })
    .returning();
  createdKeys.push(key!.id);

  expectSaved(await updateTerm(term.id, { nameKo: "블랙레벨" }, null, undefined, key!.id));

  const revs = await listRevisions(term.id);
  const latest = revs.find((r) => r.revisionNumber === 2);
  expect(latest?.authorKeyId).toBe(key!.id);
  expect(latest?.authorId).toBeNull();
});

// ----- Fix round 2: R80 -----

// R80(A1): R75는 트랜잭션 '앞' 읽기에서 term이 없는 경우를 닫았지만, 트랜잭션
// '안'의 UPDATE가 0행을 돌려주는 창은 그대로 남아 있었고 그쪽이 더 넓다.
// 라우트의 존재 확인 → updateTerm의 사전 읽기 → 여기까지 통과한 뒤에도 UPDATE
// 직전에 삭제가 커밋되면 도달한다. 블로커 트랜잭션이 DELETE를 커밋하지 않은 채
// 행 잠금을 잡고 있게 해서 결정론적으로 재현한다: updateTerm의 UPDATE가 그
// 잠금에 걸려 대기하다가, 블로커가 커밋하는 순간 0행을 보게 된다.
test("UPDATE 직전에 term이 삭제되면 500이 아니라 notFound를 돌려준다 (R80)", async () => {
  const term = await seed();

  let signalDeleted!: () => void;
  const deleted = new Promise<void>((resolve) => {
    signalDeleted = resolve;
  });
  let releaseBlocker!: () => void;
  const blockerReleased = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });

  const blockerTx = db.transaction(async (tx) => {
    await tx.delete(terms).where(eq(terms.id, term.id));
    signalDeleted();
    await blockerReleased;
  });

  await deleted;

  const updatePromise = updateTerm(term.id, { nameKo: "블랙레벨" }, null);

  await new Promise((resolve) => setTimeout(resolve, 200));
  releaseBlocker();
  await blockerTx;

  await expect(updatePromise).resolves.toEqual({ notFound: true });
});

