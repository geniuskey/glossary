import { and, eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { createDb, terms, termRevisions } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { revertTerm, type RevertResult } from "../src/lib/terms/revert.js";
import { listRevisions, updateTerm, type UpdateTermSuccess } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
});

async function seed() {
  const { term } = await createTerm(
    {
      termType: "concept",
      nameEn: "Black Level",
      nameKo: "블랙레벨",
      domain: ["ISP"],
      status: "active",
      definitionMd: "센서 출력의 기준 검정",
      surfaces: [{ text: "BLC", lang: "en", kind: "abbreviation" }],
    },
    null,
  );
  created.push(term.id);
  return term;
}

function expectSaved(result: RevertResult): UpdateTermSuccess {
  if (
    "conflict" in result
    || "slugConflict" in result
    || "invalid" in result
    || "notFound" in result
    || "revisionNotFound" in result
  ) {
    throw new Error(`예상치 못한 결과: ${JSON.stringify(result)}`);
  }
  return result;
}

test("되돌리면 리비전을 지우지 않고 새 리비전을 쌓는다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "흑레벨" }, null);

  expectSaved(await revertTerm(term.id, 1, null));

  const revs = await listRevisions(term.id);
  expect(revs.map((r) => r.revisionNumber)).toEqual([3, 2, 1]);
  expect(revs[0]!.message).toBe("#1으로 되돌림");
});

test("되돌리면 이름·정의·상태가 그 리비전의 값으로 돌아온다", async () => {
  const term = await seed();
  await updateTerm(
    term.id,
    { nameKo: "흑레벨", status: "deprecated", definitionMd: "쓰지 않는 설명" },
    null,
  );

  const reverted = expectSaved(await revertTerm(term.id, 1, null));

  expect(reverted.term.nameKo).toBe("블랙레벨");
  expect(reverted.term.status).toBe("active");
  expect(reverted.term.definitionMd).toBe("센서 출력의 기준 검정");
});

// 되돌리기가 "일부만" 되돌리면 안 된다 — 대상 리비전 이후에 추가된 표기는
// 사라져야 하고, 그때 있던 표기는 살아 있어야 한다(revert.ts의 surfaces 주석).
test("대상 리비전 이후에 추가된 표기는 되돌리면 사라진다", async () => {
  const term = await seed();
  await updateTerm(
    term.id,
    {
      surfaces: [
        { text: "BLC", lang: "en", kind: "abbreviation" },
        { text: "블랙 레벨 보정", lang: "ko", kind: "alias" },
      ],
    },
    null,
  );

  const reverted = expectSaved(await revertTerm(term.id, 1, null));

  expect(reverted.surfaces.map((s) => s.text).sort()).toEqual(["BLC", "Black Level", "블랙레벨"]);
});

// definitionMd/bodyMd는 nullable이 아니라, undefined로 두면 updateTerm이
// "안 건드림"으로 읽는다. 정의가 없던 리비전으로 되돌리면 비워져야 한다.
test("정의가 없던 리비전으로 되돌리면 나중에 쓴 정의가 지워진다", async () => {
  const { term } = await createTerm(
    { termType: "concept", nameEn: "Lens Shading", domain: [], status: "active", surfaces: [] },
    null,
  );
  created.push(term.id);
  await updateTerm(term.id, { definitionMd: "나중에 쓴 정의" }, null);

  const reverted = expectSaved(await revertTerm(term.id, 1, null));

  expect(reverted.term.definitionMd ?? "").toBe("");
});

// R130: approved는 현재 enum에 없지만 옛 리비전에는 남아 있다. 이 값만 현재의
// 공개 상태인 active로 옮겨 읽는다.
test("옛 approved 스냅샷은 active로 되돌린다", async () => {
  const term = await seed();
  const [rev1] = await db
    .select({ id: termRevisions.id, snapshot: termRevisions.snapshot })
    .from(termRevisions)
    .where(and(eq(termRevisions.termId, term.id), eq(termRevisions.revisionNumber, 1)))
    .limit(1);
  const legacy = rev1!.snapshot as { term: Record<string, unknown>; surfaces: unknown[] };
  await db
    .update(termRevisions)
    .set({ snapshot: { ...legacy, term: { ...legacy.term, status: "approved" } } })
    .where(eq(termRevisions.id, rev1!.id));

  await updateTerm(term.id, { status: "forbidden" }, null);
  const reverted = expectSaved(await revertTerm(term.id, 1, null));

  expect(reverted.term.status).toBe("active");
});

test("draft가 다시 정식 상태가 된 뒤에는 draft 스냅샷도 그대로 되돌린다", async () => {
  const term = await seed();
  const [rev1] = await db
    .select({ id: termRevisions.id, snapshot: termRevisions.snapshot })
    .from(termRevisions)
    .where(and(eq(termRevisions.termId, term.id), eq(termRevisions.revisionNumber, 1)))
    .limit(1);
  const snapshot = rev1!.snapshot as { term: Record<string, unknown>; surfaces: unknown[] };
  await db
    .update(termRevisions)
    .set({ snapshot: { ...snapshot, term: { ...snapshot.term, status: "draft" } } })
    .where(eq(termRevisions.id, rev1!.id));

  await updateTerm(term.id, { status: "forbidden" }, null);
  const reverted = expectSaved(await revertTerm(term.id, 1, null));

  expect(reverted.term.status).toBe("draft");
});

test("없는 리비전 번호로 되돌리면 revisionNotFound다", async () => {
  const term = await seed();

  const result = await revertTerm(term.id, 99, null);

  expect(result).toEqual({ revisionNotFound: true });
});

// 이력 화면을 열어 둔 사이 남이 먼저 고쳤으면 그 수정 위에 옛 내용을 덮어쓰는
// 대신 멈춰야 한다 — 되돌리기가 남의 편집을 조용히 지우면 개방 편집이 무너진다.
test("기대 리비전이 어긋나면 충돌을 반환하고 저장하지 않는다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "흑레벨" }, null);

  const result = await revertTerm(term.id, 1, null, 1);

  expect(result).toEqual({ conflict: true, currentRevision: 2 });
  const revs = await listRevisions(term.id);
  expect(revs).toHaveLength(2);
});

test("기대 리비전이 현재와 같으면 되돌린다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "흑레벨" }, null);

  const reverted = expectSaved(await revertTerm(term.id, 1, null, 2));

  expect(reverted.term.nameKo).toBe("블랙레벨");
});

test("되돌린 리비전을 다시 되돌리면 되돌리기 직전 상태로 돌아온다", async () => {
  const term = await seed();
  await updateTerm(term.id, { nameKo: "흑레벨" }, null);
  await revertTerm(term.id, 1, null);

  const reverted = expectSaved(await revertTerm(term.id, 2, null));

  expect(reverted.term.nameKo).toBe("흑레벨");
});
