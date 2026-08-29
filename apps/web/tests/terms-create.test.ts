import { eq, inArray, like, or, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createDb, terms, termRevisions, termSurfaces } from "@grossary/db";
import { isUuid } from "../src/lib/api-error.js";
import { createTerm, isSlugConflict, RESERVED_SLUGS } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];

// 이 파일이 만드는 슬러그는 고정된 값이다 (ae / auto-exposure(-N) / black-level /
// gain(-N) / retry-probe(-N)). 이전 실행이 afterEach를 못 돌고 죽었으면 같은
// 슬러그·표기의 행이 남아있을 수 있고, 그러면 "슬러그가 겹치면 접미사를 붙인다"나
// "경고는 정확히 1개" 같은 정확한 값 검증이 남아있던 행 때문에 조용히 틀어진다.
// beforeAll/afterAll에서 이 파일이 쓰는 슬러그 패턴을 명시적으로 지워서, 남은
// 행이 결과에 섞이지 않게 한다.
//
// M6(리뷰): 예전에는 `LIKE 'gain%'`을 곧바로 DELETE 조건으로 썼는데, 이건
// "gain-control"이나 "gainmap" 같은 무관한 슬러그도 지운다. LIKE는 DB에서 후보를
// 좁히는 용도로만 쓰고, 정확히 "gain" 또는 "gain-<숫자>"인지는 JS 정규식으로
// 다시 앵커링한 뒤에만 삭제한다.
async function purgeFixtures() {
  const exactPattern = /^(gain|auto-exposure|retry-probe)(-\d+)?$/;
  const candidates = await db
    .select({ id: terms.id, slug: terms.slug })
    .from(terms)
    .where(or(like(terms.slug, "gain%"), like(terms.slug, "auto-exposure%"), like(terms.slug, "retry-probe%")));
  const ids = candidates.filter((r) => exactPattern.test(r.slug)).map((r) => r.id);

  await db
    .delete(terms)
    .where(or(eq(terms.slug, "ae"), eq(terms.slug, "black-level"), ids.length ? inArray(terms.id, ids) : sql`false`));
}

beforeAll(purgeFixtures);
afterAll(purgeFixtures);

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
});

test("표준 표기가 canonical surface로 함께 저장된다", async () => {
  const { term } = await createTerm(
    {
      termType: "abbreviation",
      nameEn: "AE",
      fullNameEn: "Auto Exposure",
      nameKo: "자동노출",
      domain: ["ISP"],
      status: "active",
      surfaces: [],
    },
    null,
  );
  created.push(term.id);

  const surfaces = await db.select().from(termSurfaces).where(eq(termSurfaces.termId, term.id));
  const texts = surfaces.map((s) => s.text).sort();
  expect(texts).toEqual(["AE", "Auto Exposure", "자동노출"]);
  expect(surfaces.find((s) => s.text === "Auto Exposure")?.kind).toBe("full_name");
});

test("같은 정규화 키를 가진 기존 용어가 있으면 경고를 반환하되 저장은 한다", async () => {
  const first = await createTerm(
    { termType: "term", nameEn: "Auto Exposure", domain: ["ISP"], status: "active", surfaces: [] },
    null,
  );
  created.push(first.term.id);

  const second = await createTerm(
    { termType: "term", nameEn: "auto-exposure", domain: ["PM"], status: "active", surfaces: [] },
    null,
  );
  created.push(second.term.id);

  // M6(리뷰): purge는 슬러그 단위로 지우지만 이 단언은 normLoose 단위 배열을
  // 본다. 다른 테스트/이전 크래시 실행이 우연히 같은 normLoose("autoexposure")로
  // 정규화되는 표기를 다른 슬러그로 남겼다면 `toHaveLength(1)`은 그 잔여물
  // 때문에 깨질 수 있다. 이 fixture가 실제로 만든 first.term.id를 향한 경고만
  // 걸러서 확인한다 — 전체 배열 길이는 전제하지 않는다.
  const ownWarnings = second.warnings.filter((w) => w.conflictingTermId === first.term.id);
  expect(ownWarnings).toHaveLength(1);
  expect(ownWarnings[0]!.surfaceText).toBe("Auto Exposure");
  expect(second.term.id).toBeDefined();
});

test("생성 시 1번 리비전이 기록되고 snapshot에 term/surfaces 내용이 담긴다", async () => {
  const { term, surfaces } = await createTerm(
    { termType: "term", nameEn: "Black Level", domain: ["ISP"], status: "active", surfaces: [] },
    null,
  );
  created.push(term.id);

  const revs = await db.select().from(termRevisions).where(eq(termRevisions.termId, term.id));
  expect(revs).toHaveLength(1);
  expect(revs[0]!.revisionNumber).toBe(1);

  // m1(리뷰): 리비전 개수/번호만 확인하면 snapshot 컬럼 자체가 빈 객체({})나
  // 엉뚱한 값으로 저장되어도 통과한다. 실제 term/surfaces 내용이 들어있는지
  // 직접 확인한다.
  const snapshot = revs[0]!.snapshot as { term: { id: string; slug: string; nameEn: string | null }; surfaces: unknown[] };
  expect(snapshot.term.id).toBe(term.id);
  expect(snapshot.term.slug).toBe("black-level");
  expect(snapshot.term.nameEn).toBe("Black Level");
  expect(snapshot.surfaces).toHaveLength(surfaces.length);
  expect(snapshot.surfaces).toEqual(surfaces);
});

test("슬러그가 겹치면 접미사를 붙여 고유하게 만든다", async () => {
  const a = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "active", surfaces: [] }, null);
  const b = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "active", surfaces: [] }, null);
  created.push(a.term.id, b.term.id);

  expect(a.term.slug).toBe("gain");
  expect(b.term.slug).toBe("gain-2");
});

// M1(리뷰): R32는 세 insert를 하나의 트랜잭션으로 묶는다는 결정인데, 그걸 직접
// 검증하는 테스트가 없었다 — 세 개의 독립된 statement로 바꿔도(트랜잭션을
// 통째로 지워도) 57개 테스트가 그린이었다. term_revisions에 정상 insert를
// 실패시키는 NOT VALID CHECK를 임시로 걸어 createTerm이 실패하는 걸 확인하고,
// terms/term_surfaces에도 아무 것도 안 남았는지 직접 본다.
test("트랜잭션 중간(리비전 insert)이 실패하면 terms/term_surfaces에도 아무 것도 남지 않는다 (R32)", async () => {
  await db.execute(
    sql`ALTER TABLE term_revisions ADD CONSTRAINT rollback_probe_check CHECK (message <> 'created') NOT VALID`,
  );
  try {
    await expect(
      createTerm(
        { termType: "term", nameEn: "Rollback Probe", domain: [], status: "active", surfaces: [] },
        null,
      ),
    ).rejects.toThrow();

    const termRows = await db.select().from(terms).where(eq(terms.slug, "rollback-probe"));
    expect(termRows).toHaveLength(0);

    const surfaceRows = await db.select().from(termSurfaces).where(eq(termSurfaces.text, "Rollback Probe"));
    expect(surfaceRows).toHaveLength(0);
  } finally {
    await db.execute(sql`ALTER TABLE term_revisions DROP CONSTRAINT rollback_probe_check`);
  }
});

// M2(리뷰): R33은 schema.ts에 bodyMd 필드를 추가하고 create.ts에서 그 값을
// terms.body_md로 써야 한다는 결정이지만, bodyMd를 채워서 호출하는 테스트가
// 하나도 없었다 — create.ts에서 bodyMd 줄을 통째로 지워도 57개 테스트가
// 그린이었다.
test("bodyMd가 저장되고 그대로 반환된다 (R33)", async () => {
  const bodyMd = "# 제목\n\n본문 내용입니다.";
  const { term } = await createTerm(
    { termType: "term", nameEn: "Body Md Probe", domain: [], status: "active", surfaces: [], bodyMd },
    null,
  );
  created.push(term.id);

  expect(term.bodyMd).toBe(bodyMd);

  const [row] = await db.select().from(terms).where(eq(terms.id, term.id));
  expect(row!.bodyMd).toBe(bodyMd);
});

// R48: isSlugConflict은 재시도 여부를 가르는 순수 판별 함수다. 다른 23505(예:
// term_surfaces_unique)까지 삼켜버리면 진짜 무결성 문제를 조용히 숨기게 된다.
test("isSlugConflict은 terms_slug_unique 위반만 참으로 판별한다 (R48)", () => {
  expect(isSlugConflict({ code: "23505", constraint_name: "terms_slug_unique" })).toBe(true);
  expect(isSlugConflict({ code: "23505", constraint_name: "term_surfaces_unique" })).toBe(false);
  expect(isSlugConflict({ code: "23503", constraint_name: "terms_slug_unique" })).toBe(false);
  expect(isSlugConflict(new Error("boom"))).toBe(false);
  expect(isSlugConflict(null)).toBe(false);
  expect(isSlugConflict(undefined)).toBe(false);
});

// R48: 진짜 경합은 uniqueSlug의 SELECT와 트랜잭션의 INSERT 사이의 창에서만
// 일어나므로 순차 실행으로는 자연히 재현되지 않는다. Postgres 자체의 잠금
// 대기를 이용해 결정론적으로 만든다: 트랜잭션 A가 slug="retry-probe" 행을
// insert하고 커밋하지 않은 채 열어 둔다. 그 사이 createTerm의 uniqueSlug
// SELECT는(READ COMMITTED라 커밋 안 된 행을 못 본다) 여전히 "retry-probe"가
// 비어있다고 판단해 같은 슬러그로 INSERT를 시도하고, 그 INSERT는 A가 커밋할
// 때까지 잠금 대기에 들어간다. A를 커밋시키면 그제서야 진짜 23505가 뜨고,
// createTerm의 재시도 루프가 새 슬러그로 다시 시도해 성공해야 한다.
test("슬러그 경합이 나면 재시도해서 -2로 저장한다 (R48)", async () => {
  let signalInserted!: () => void;
  const inserted = new Promise<void>((resolve) => {
    signalInserted = resolve;
  });
  let releaseBlocker!: () => void;
  const blockerReleased = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });

  const blockerTx = db.transaction(async (tx) => {
    const [row] = await tx
      .insert(terms)
      .values({ slug: "retry-probe", termType: "term", nameEn: "Retry Probe Blocker", domain: [], status: "active" })
      .returning();
    created.push(row!.id);
    signalInserted();
    await blockerReleased;
  });

  await inserted;

  const createPromise = createTerm(
    { termType: "term", nameEn: "Retry Probe", domain: [], status: "active", surfaces: [] },
    null,
  );

  // createTerm의 uniqueSlug SELECT + INSERT가 실제로 실행되어 잠금 대기에
  // 들어갈 시간을 준다. 이 대기는 정확성의 필요조건은 아니다(커밋 전 행은
  // 격리 수준상 어차피 안 보인다) — 다만 INSERT가 실제로 잠금을 걸 때까지
  // 기다렸다가 블로커를 커밋해야, "블로커가 먼저 커밋되고 나서야 createTerm이
  // SELECT/INSERT를 시작하는" 순서가 되어 충돌 자체가 안 일어나는 경우를 막는다.
  await new Promise((resolve) => setTimeout(resolve, 200));
  releaseBlocker();
  await blockerTx;

  const result = await createPromise;
  created.push(result.term.id);
  expect(result.term.slug).toBe("retry-probe-2");
});

// R92: `app/terms/new`는 정적 세그먼트다(Task 13). Next는 정적 세그먼트를
// 동적 세그먼트(`app/terms/[slug]`)보다 먼저 매칭하므로, slugify("New") ===
// "new"인 용어는 상세 페이지에 영원히 도달할 수 없고 "새 용어" 폼이 대신
// 뜬다 — R86(예약어 "lookup")과 정확히 같은 결함이 한 마일스톤 뒤에
// 반복되는 것이다. uniqueSlug가 이미 사용 중인 것처럼 취급해 피해야 한다.
test("R92: 이름이 New인 용어는 슬러그가 new가 되지 않는다", async () => {
  expect(RESERVED_SLUGS.has("new")).toBe(true);

  const { term } = await createTerm(
    { termType: "term", nameEn: "New", domain: [], status: "active", surfaces: [] },
    null,
  );
  created.push(term.id);
  expect(term.slug).not.toBe("new");
});

// F2(review §3): slugify는 하이픈과 16진 문자를 보존하므로 이름이 UUID
// 모양이면 slug도 UUID 모양이 될 수 있다. getTermByIdOrSlug는 isUuid(idOrSlug)
// 이면 id로만 조회하므로, 그런 slug는 자기 자신으로는 영원히 조회되지 않는다
// (목록에는 링크가 뜨지만 클릭하면 404) — uniqueSlug가 그 모양을 "이미 사용
// 중"으로 취급해 접미사를 붙여야 한다.
test("F2: UUID 모양의 이름으로 만든 용어는 slug가 UUID 모양이 되지 않는다", async () => {
  const { term } = await createTerm(
    {
      termType: "product_id",
      nameEn: "550e8400 e29b 41d4 a716 446655440000",
      domain: [],
      status: "active",
      surfaces: [],
    },
    null,
  );
  created.push(term.id);
  expect(isUuid(term.slug)).toBe(false);
});
