import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms } from "@grossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { searchTerms, suggestTerms } from "../src/lib/terms/search.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const ids: string[] = [];

// 이 파일의 fixture는 다른 파일과 겹치지 않는 어휘를 쓴다(XSRCH 접미사) —
// 검색은 유사도 매치까지 하므로, 흔한 단어를 쓰면 남이 만든 행이 결과에 섞여
// "정확 매치가 먼저 온다" 같은 순서 단언이 이유 없이 흔들린다.
let socId = "";
let otherId = "";
let qzzId = "";
let pctId = "";
let pctPlainId = "";
let draftId = "";

beforeAll(async () => {
  const soc = await createTerm(
    {
      termType: "concept",
      nameEn: "SystemOnChipXSRCH",
      nameKo: "시스템온칩XSRCH",
      domain: ["HW"],
      status: "active",
      definitionMd: "하나의 칩에 시스템 전체를 올린 것.",
      surfaces: [{ text: "SoCXSRCH", lang: "en", kind: "alias" }],
    },
    null,
  );
  socId = soc.term.id;
  ids.push(socId);

  const other = await createTerm(
    {
      termType: "concept",
      nameEn: "SocketXSRCH",
      domain: ["HW"],
      status: "active",
      surfaces: [],
    },
    null,
  );
  otherId = other.term.id;
  ids.push(otherId);

  // R136: 접두사가 짧아 trigram 유사도로는 절대 안 걸리는 자동완성용 fixture.
  const qzz = await createTerm(
    { termType: "concept", nameEn: "QzzThermalXSRCH", domain: [], status: "active", surfaces: [] },
    null,
  );
  qzzId = qzz.term.id;
  ids.push(qzzId);

  // R136: LIKE 이스케이프용 한 쌍. 표기에 `%`가 들어간 것과, 그 `%`가
  // 와일드카드로 새면 함께 걸려 버리는 것.
  const pct = await createTerm(
    { termType: "concept", nameEn: "XsrchpctFifty%", domain: [], status: "active", surfaces: [] },
    null,
  );
  pctId = pct.term.id;
  ids.push(pctId);

  const pctPlain = await createTerm(
    { termType: "concept", nameEn: "XsrchpctFiftyAaa", domain: [], status: "active", surfaces: [] },
    null,
  );
  pctPlainId = pctPlain.term.id;
  ids.push(pctPlainId);

  const draft = await createTerm(
    {
      termType: "concept",
      nameEn: "HiddenDraftXSRCH",
      domain: ["QA"],
      status: "draft",
      definitionMd: "검색에 아직 노출하지 않는 초안.",
      surfaces: [],
    },
    null,
  );
  draftId = draft.term.id;
  ids.push(draftId);
});

afterAll(async () => {
  for (const id of ids) await db.delete(terms).where(eq(terms.id, id));
});

test("별칭으로 찾아도 개념에 닿고, 무엇으로 맞았는지 함께 돌려준다", async () => {
  const hits = await searchTerms("SoCXSRCH");
  const hit = hits.find((h) => h.id === socId);

  expect(hit).toBeDefined();
  expect(hit!.matchedText).toBe("SoCXSRCH");
  expect(hit!.matchedKind).toBe("alias");
  expect(hit!.exact).toBe(true);
  // 결과 줄에 정의 두 줄을 보여준다 — TermSummary에는 없는 필드라 여기서 함께
  // 가져오지 않으면 화면이 조용히 비어 보인다.
  expect(hit!.definitionMd).toContain("칩");
  expect(hit!.categoryLabel).toBeNull();
  expect(hit).toHaveProperty("ownerId");
  expect(hit).toHaveProperty("ownerName");
});

test("정규화가 다른 표기(대소문자·공백·기호)로도 같은 개념에 닿는다", async () => {
  const hits = await searchTerms("  soc-xsrch ");
  expect(hits.map((h) => h.id)).toContain(socId);
});

test("정확히 맞은 표기가 비슷한 표기보다 먼저 온다", async () => {
  // "SocketXSRCH"는 "SoCXSRCH"와 trigram이 겹쳐 유사도 매치로 함께 잡힌다.
  const hits = await searchTerms("SoCXSRCH");
  const rank = (id: string) => hits.findIndex((h) => h.id === id);

  expect(rank(socId)).toBe(0);
  if (rank(otherId) !== -1) {
    expect(hits[rank(otherId)]!.exact).toBe(false);
  }
});

test("한 용어의 표기가 여러 개 걸려도 결과는 용어당 한 줄이다", async () => {
  // 표준명("SystemOnChipXSRCH")과 별칭("SoCXSRCH")이 둘 다 후보로 잡히는 검색어.
  const hits = await searchTerms("SystemOnChipXSRCH");
  expect(hits.filter((h) => h.id === socId)).toHaveLength(1);
});

test("정규화하면 빈 문자열이 되는 입력은 아무것도 찾지 않는다", async () => {
  // 걸러내지 않으면 similarity('', ...)가 표기 테이블 전체를 훑는다.
  expect(await searchTerms("   ")).toEqual([]);
  expect(await searchTerms("---")).toEqual([]);
});

test("limit을 넘겨 돌려주지 않는다", async () => {
  const hits = await searchTerms("SoCXSRCH", 1);
  expect(hits.length).toBeLessThanOrEqual(1);
});

test("draft는 기본 검색과 자동완성에 노출되지 않는다", async () => {
  expect((await searchTerms("HiddenDraftXSRCH")).map((hit) => hit.id)).not.toContain(draftId);
  expect((await suggestTerms("HiddenDraftXSRCH")).map((hit) => hit.id)).not.toContain(draftId);
});

// --- suggestTerms (R136, 자동완성) -------------------------------------------

test("suggestTerms: trigram으로는 못 잡는 짧은 앞부분도 자동완성된다", async () => {
  // "qzz"는 "QzzThermalXSRCH"와 유사도 0.15 남짓이라 `%` 연산자만으로는 결과가
  // 비어 있다 — 접두사 LIKE 가지가 사라지면 이 테스트가 먼저 깨진다.
  const items = await suggestTerms("Qzz");
  const hit = items.find((s) => s.id === qzzId);

  expect(hit).toBeDefined();
  expect(hit!.prefix).toBe(true);
  expect(hit!.exact).toBe(false);
});

test("suggestTerms: 정확히 맞은 표기는 무엇으로 맞았는지 함께 온다", async () => {
  const items = await suggestTerms("SoCXSRCH");
  const hit = items.find((s) => s.id === socId);

  expect(hit).toBeDefined();
  expect(hit!.matchedText).toBe("SoCXSRCH");
  expect(hit!.matchedKind).toBe("alias");
  expect(hit!.exact).toBe(true);
  expect(items[0]!.id).toBe(socId);
});

test("suggestTerms: 오타는 유사 매치로 잡히되 자동완성으로 분류되지 않는다", async () => {
  // prefix가 true로 새면 화면에서 오타가 "자동완성" 묶음에 섞여, 사용자는 자기가
  // 잘못 쳤다는 사실을 끝까지 모른다(groupSuggestions의 전제).
  const items = await suggestTerms("SocketXSRCG");
  const hit = items.find((s) => s.id === otherId);

  expect(hit).toBeDefined();
  expect(hit!.prefix).toBe(false);
  expect(hit!.exact).toBe(false);
});

test("suggestTerms: 표기 안의 %는 와일드카드가 아니다", async () => {
  // 이스케이프가 빠지면 패턴이 "xsrchpctfifty%%"가 되어 "...FiftyAaa"까지
  // 접두사 매치로 잡힌다. 에러는 나지 않고 목록만 조용히 틀린다.
  const items = await suggestTerms("XsrchpctFifty%");

  expect(items.find((s) => s.id === pctId)?.prefix).toBe(true);
  const plain = items.find((s) => s.id === pctPlainId);
  expect(plain).toBeDefined(); // 유사도로는 잡힌다 — 접두사냐 아니냐가 쟁점이다
  expect(plain!.prefix).toBe(false);
});

test("suggestTerms: 한 용어의 표기가 여럿 걸려도 후보는 용어당 하나다", async () => {
  const items = await suggestTerms("S");
  expect(items.filter((s) => s.id === socId).length).toBeLessThanOrEqual(1);

  const byName = await suggestTerms("SystemOnChipXSRCH");
  expect(byName.filter((s) => s.id === socId)).toHaveLength(1);
});

test("suggestTerms: limit과 빈 정규화를 지킨다", async () => {
  expect((await suggestTerms("S", 3)).length).toBeLessThanOrEqual(3);
  expect(await suggestTerms("   ")).toEqual([]);
  expect(await suggestTerms("---")).toEqual([]);
});
