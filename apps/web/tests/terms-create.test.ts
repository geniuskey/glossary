import { eq, like, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createDb, terms, termRevisions, termSurfaces } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const created: string[] = [];

// 이 파일이 만드는 슬러그는 고정된 값이다 (ae / auto-exposure(-N) / black-level / gain(-N)).
// 이전 실행이 afterEach를 못 돌고 죽었으면 같은 슬러그·표기의 행이 남아있을 수 있고,
// 그러면 "슬러그가 겹치면 접미사를 붙인다"나 "경고는 정확히 1개" 같은 정확한 값 검증이
// 남아있던 행 때문에 조용히 틀어진다. beforeAll/afterAll에서 이 파일이 쓰는 슬러그
// 패턴을 명시적으로 지워서, 남은 행이 결과에 섞이지 않게 한다.
async function purgeFixtures() {
  await db
    .delete(terms)
    .where(
      or(
        eq(terms.slug, "ae"),
        like(terms.slug, "auto-exposure%"),
        eq(terms.slug, "black-level"),
        like(terms.slug, "gain%"),
      ),
    );
}

beforeAll(purgeFixtures);
afterAll(purgeFixtures);

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(terms).where(eq(terms.id, id));
});

test("표준 표기가 canonical surface로 함께 저장된다", async () => {
  const { term } = await createTerm(
    { termType: "abbreviation", nameEn: "AE", fullNameEn: "Auto Exposure", nameKo: "자동노출",
      domain: ["ISP"], status: "approved", surfaces: [] },
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
    { termType: "term", nameEn: "Auto Exposure", domain: ["ISP"], status: "approved", surfaces: [] },
    null,
  );
  created.push(first.term.id);

  const second = await createTerm(
    { termType: "term", nameEn: "auto-exposure", domain: ["PM"], status: "draft", surfaces: [] },
    null,
  );
  created.push(second.term.id);

  expect(second.warnings).toHaveLength(1);
  expect(second.warnings[0]!.conflictingTermId).toBe(first.term.id);
  expect(second.term.id).toBeDefined();
});

test("생성 시 1번 리비전이 기록된다", async () => {
  const { term } = await createTerm(
    { termType: "term", nameEn: "Black Level", domain: ["ISP"], status: "draft", surfaces: [] },
    null,
  );
  created.push(term.id);

  const revs = await db.select().from(termRevisions).where(eq(termRevisions.termId, term.id));
  expect(revs).toHaveLength(1);
  expect(revs[0]!.revisionNumber).toBe(1);
});

test("슬러그가 겹치면 접미사를 붙여 고유하게 만든다", async () => {
  const a = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "draft", surfaces: [] }, null);
  const b = await createTerm({ termType: "term", nameEn: "Gain", domain: [], status: "draft", surfaces: [] }, null);
  created.push(a.term.id, b.term.id);

  expect(a.term.slug).toBe("gain");
  expect(b.term.slug).toBe("gain-2");
});
