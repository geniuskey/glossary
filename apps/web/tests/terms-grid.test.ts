import { expect, test } from "vitest";
import { TERM_TYPES } from "../src/lib/terms/enums.js";
import {
  applyPatch,
  cellText,
  clampColumnWidth,
  clampMenuPosition,
  columnByKey,
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  defaultHiddenColumns,
  GRID_COLUMNS,
  inRange,
  inversePatch,
  isDensity,
  normalizeRange,
  opensOnClick,
  opensUp,
  parseClipboardMatrix,
  patchForCell,
  planCell,
  planClear,
  planFill,
  planPaste,
  rangeCells,
  rangeToTsv,
  rowLabel,
  MENU_EDGE_GAP,
  rowsToMatrix,
  toCsv,
  toggleHiddenColumn,
  toTsv,
  visibleColumns,
  wouldClearBothNames,
  type TermRow,
} from "../src/lib/terms/grid.js";

// R97: terms-grid.tsx는 "use client"라 jsdom 없는 이 저장소에서 렌더 테스트를
// 할 수 없다. 그래서 표에서 실제로 틀릴 수 있는 판단(빈 셀의 의미, enum 검증,
// 내보내기 이스케이프)을 전부 이 순수 모듈로 뽑아 두고 여기서 검증한다.

function row(overrides: Partial<TermRow> = {}): TermRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "interstitial-slide-point",
    termType: "term",
    nameEn: "Interstitial Slide Point",
    nameKo: "중간 슬라이드 지점",
    fullNameEn: null,
    fullNameKo: null,
    domain: ["ISP"],
    status: "active",
    definitionMd: null,
    bodyMd: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    editorName: "김테스트",
    revision: 3,
    ...overrides,
  };
}

test("patchForCell: 표준명/풀네임을 비우면 null(지운다)이 된다", () => {
  // R117: 빈 문자열이 아니라 null이어야 한다 — 빈 문자열은 스키마에서 400이고,
  // 필드를 아예 빼면 PATCH에서 "안 건드림"을 뜻해 셀을 비울 방법이 사라진다.
  for (const key of ["nameEn", "nameKo", "fullNameEn", "fullNameKo"] as const) {
    expect(patchForCell(key, "   ")).toEqual({ patch: { [key]: null } });
  }
});

test("patchForCell: 정의·본문을 비우면 빈 문자열이다(null이 아니다)", () => {
  // termInputBaseSchema에서 definitionMd/bodyMd는 nullable이 아니라 optional
  // string이다. 여기서 null을 보내면 400이 된다.
  expect(patchForCell("definitionMd", "  ")).toEqual({ patch: { definitionMd: "" } });
  expect(patchForCell("bodyMd", "  ")).toEqual({ patch: { bodyMd: "" } });
});

test("patchForCell: 값은 trim된다", () => {
  expect(patchForCell("nameEn", "  Slide Point  ")).toEqual({ patch: { nameEn: "Slide Point" } });
});

test("patchForCell: 도메인은 쉼표와 줄바꿈 둘 다로 쪼개고 중복·빈 항목을 없앤다", () => {
  const result = patchForCell("domain", " ISP, PM\nISP ,, \n RF ");
  expect(result).toEqual({ patch: { domain: ["ISP", "PM", "RF"] } });
});

test("patchForCell: 알 수 없는 enum 값은 patch가 아니라 error다", () => {
  const type = patchForCell("termType", "not-a-type");
  const status = patchForCell("status", "not-a-status");
  expect(type).toHaveProperty("error");
  expect(status).toHaveProperty("error");
  // 잘못 친 값이 메시지에 그대로 보여야 무엇을 고쳐야 할지 알 수 있다.
  expect((type as { error: string }).error).toContain("not-a-type");
});

test("patchForCell: 알려진 enum 값은 그대로 통과한다", () => {
  for (const t of TERM_TYPES) {
    expect(patchForCell("termType", t)).toEqual({ patch: { termType: t } });
  }
  expect(patchForCell("status", "deprecated")).toEqual({ patch: { status: "deprecated" } });
});

test("patchForCell: 읽기 전용 열은 항상 error다", () => {
  expect(patchForCell("slug", "new-slug")).toHaveProperty("error");
  expect(patchForCell("updatedAt", "2026-01-01")).toHaveProperty("error");
});

test("wouldClearBothNames: 마지막 표준명을 지우는 편집만 참이다", () => {
  const both = row();
  expect(wouldClearBothNames(both, { nameEn: null })).toBe(false);

  const onlyEn = row({ nameKo: null });
  expect(wouldClearBothNames(onlyEn, { nameEn: null })).toBe(true);
  expect(wouldClearBothNames(onlyEn, { nameEn: "Other" })).toBe(false);
  // 관계없는 열을 고치는 것만으로 참이 되면 안 된다.
  expect(wouldClearBothNames(onlyEn, { status: "deprecated" })).toBe(false);
});

test("applyPatch는 원본을 건드리지 않는다(실패 시 되돌리기가 이것에 의존한다)", () => {
  const original = row();
  const next = applyPatch(original, { status: "deprecated" });
  expect(next.status).toBe("deprecated");
  expect(original.status).toBe("active");
});

test("cellText: 도메인은 쉼표로 합쳐지고, 값이 없는 열은 빈 문자열이다", () => {
  const r = row({ domain: ["ISP", "PM"], definitionMd: null });
  expect(cellText(r, "domain")).toBe("ISP, PM");
  expect(cellText(r, "definitionMd")).toBe("");
  expect(cellText(r, "nameEn")).toBe("Interstitial Slide Point");
});

test("cellText(domain)와 patchForCell(domain)은 왕복해도 값이 그대로다", () => {
  // 셀을 열었다가 아무것도 안 고치고 Enter만 쳐도 도메인이 바뀌면 안 된다.
  const r = row({ domain: ["ISP", "PM"] });
  expect(patchForCell("domain", cellText(r, "domain"))).toEqual({ patch: { domain: ["ISP", "PM"] } });
});

test("기본 숨김 열은 실제로 hiddenByDefault가 붙은 열들이다", () => {
  // 풀네임은 더 이상 숨기지 않는다 — 안 보이는 열은 표에서 고칠 방법이 없다.
  // 본문만 접어 둔다(문서 한 편이 들어가는 칸이라 모든 줄이 덩어리가 된다).
  expect(defaultHiddenColumns()).toEqual(["bodyMd"]);
  // 전부 숨겨지면 표가 빈 화면이 된다.
  expect(defaultHiddenColumns().length).toBeLessThan(GRID_COLUMNS.length);
});

test("상세 폼에서 고칠 수 있는 필드는 표에도 전부 열이 있다", () => {
  // "/terms에서도 모두 수정 가능"의 기준을 term-form.tsx가 편집하는 필드 집합에
  // 맞춰 고정한다. 스키마에 필드가 하나 늘었는데 표만 빠지면 여기서 걸린다.
  const editable = GRID_COLUMNS.filter((c) => c.kind !== "readonly").map((c) => c.key);
  expect([...editable].sort()).toEqual(
    [
      "bodyMd",
      "definitionMd",
      "domain",
      "fullNameEn",
      "fullNameKo",
      "nameEn",
      "nameKo",
      "status",
      "termType",
    ].sort(),
  );
});

test("slug·최근 수정만 읽기 전용이다", () => {
  // slug는 termPatchSchema에 아예 없고(주소가 곧 신분이라 상세 폼도 안 건드린다),
  // updatedAt은 저장할 때 서버가 찍는 값이다.
  const readonly = GRID_COLUMNS.filter((c) => c.kind === "readonly").map((c) => c.key);
  expect(readonly).toEqual(["slug", "updatedAt"]);
  for (const key of readonly) {
    expect(patchForCell(key, "아무 값")).toHaveProperty("error");
  }
});

test("클릭 한 번에 열리는 열은 종류·상태·정의·본문뿐이다", () => {
  // 나머지 열까지 클릭으로 열면 드래그로 범위를 잡을 수 없게 되어
  // 복사·붙여넣기·아래로 채우기가 통째로 죽는다.
  const opening = GRID_COLUMNS.filter(opensOnClick).map((c) => c.key);
  expect(opening).toEqual(["termType", "status", "definitionMd", "bodyMd"]);
});

// 스크롤 상자가 0~800이고 한 행이 32px일 때의 좌표. 목록은 178px쯤 된다.
const CLIP = { top: 0, bottom: 800 };
const LIST = 178;

test("표에 한 행뿐이어도 목록은 아래로 열린다", () => {
  // 행 번호로 방향을 정하던 시절의 버그: "아래에서 넷째 행부터 위로"라는
  // 규칙에서 행이 셋 이하면 첫 행도 위로 열렸다. 위는 표 바깥이라 목록이
  // 통째로 잘려 나가고, 눌러도 회색 그림자만 번지는 화면이 됐다.
  expect(opensUp(LIST, { top: 40, bottom: 72 }, CLIP)).toBe(false);
});

test("아래 공간이 모자라면 위로 연다", () => {
  expect(opensUp(LIST, { top: 700, bottom: 732 }, CLIP)).toBe(true);
});

test("위아래 둘 다 모자라면 아래로 연다", () => {
  // 위가 아래보다 넓어도 마찬가지다. 아래로 삐져나온 부분은 표를 굴려서 마저
  // 볼 수 있지만, 위로 삐져나온 부분은 영영 닿을 수 없다.
  expect(opensUp(LIST, { top: 40, bottom: 72 }, { top: 0, bottom: 100 })).toBe(false);
});

test("columnByKey: 모든 GRID_COLUMNS 키가 조회된다", () => {
  for (const c of GRID_COLUMNS) {
    expect(columnByKey(c.key).label).toBe(c.label);
  }
});

test("rowsToMatrix: 첫 줄은 열 라벨이고 그 뒤가 행이다", () => {
  const columns = [columnByKey("nameEn"), columnByKey("status")];
  expect(rowsToMatrix([row()], columns)).toEqual([
    ["영문 표준명", "상태"],
    ["Interstitial Slide Point", "active"],
  ]);
});

test("toTsv: 값 안의 탭·줄바꿈은 구분자와 섞이지 않게 공백이 된다", () => {
  const columns = [columnByKey("nameEn"), columnByKey("definitionMd")];
  const tsv = toTsv([row({ definitionMd: "첫 줄\n둘째\t줄" })], columns);
  const lines = tsv.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]?.split("\t")).toHaveLength(2);
  expect(lines[1]).toContain("첫 줄 둘째 줄");
});

test("toCsv: 모든 값을 따옴표로 감싸고 값 안의 따옴표는 두 번 쓴다(RFC4180)", () => {
  const columns = [columnByKey("nameEn"), columnByKey("definitionMd")];
  const csv = toCsv([row({ nameEn: 'He said "hi"', definitionMd: "a,b" })], columns);
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe('"영문 표준명","정의"');
  expect(lines[1]).toBe('"He said ""hi""","a,b"');
});

test("자기검사: 판별식이 아무 값에나 참이 되지 않는다", () => {
  expect(patchForCell("nameEn", "x")).not.toHaveProperty("error");
  expect(defaultHiddenColumns()).not.toContain("nameEn");
});

// --- 범위 선택 / 붙여넣기 ---------------------------------------------------

const NAME_COLUMNS = [columnByKey("nameEn"), columnByKey("nameKo")];

function pair(): TermRow[] {
  return [
    row({ id: "a", slug: "alpha", nameEn: "Alpha", nameKo: "알파" }),
    row({ id: "b", slug: "beta", nameEn: "Beta", nameKo: "베타" }),
  ];
}

test("normalizeRange: 어느 모서리에서 끌었든 같은 직사각형이 된다", () => {
  const forward = normalizeRange({ r: 1, c: 0 }, { r: 3, c: 2 });
  const backward = normalizeRange({ r: 3, c: 2 }, { r: 1, c: 0 });
  expect(forward).toEqual({ r0: 1, r1: 3, c0: 0, c1: 2 });
  expect(backward).toEqual(forward);
});

test("inRange/rangeCells: 경계를 포함해서 센다", () => {
  const range = normalizeRange({ r: 1, c: 1 }, { r: 2, c: 3 });
  expect(rangeCells(range)).toBe(6);
  expect(inRange(range, 1, 1)).toBe(true);
  expect(inRange(range, 2, 3)).toBe(true);
  expect(inRange(range, 0, 1)).toBe(false);
  expect(inRange(range, 2, 4)).toBe(false);
});

test("parseClipboardMatrix: 줄바꿈 종류와 끝의 빈 줄에 흔들리지 않는다", () => {
  // 엑셀은 보통 마지막 셀 뒤에도 줄바꿈을 붙여 준다. 그걸 한 행으로 세면
  // 표 맨 끝 줄을 빈 값으로 덮어쓰게 된다.
  expect(parseClipboardMatrix("a\tb\r\nc\td\r\n")).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
  expect(parseClipboardMatrix("a\rb")).toEqual([["a"], ["b"]]);
  expect(parseClipboardMatrix("")).toEqual([]);
  expect(parseClipboardMatrix("\n\n")).toEqual([]);
});

test("parseClipboardMatrix: 가운데 빈 칸은 빈 문자열로 남는다", () => {
  // 빈 칸을 버리면 열이 하나씩 밀려서 엉뚱한 열에 값이 들어간다.
  expect(parseClipboardMatrix("a\t\tc")).toEqual([["a", "", "c"]]);
});

test("rangeToTsv: 선택한 직사각형만, 머리글 없이 내보낸다", () => {
  const rows = pair();
  const range = normalizeRange({ r: 0, c: 1 }, { r: 1, c: 1 });
  expect(rangeToTsv(rows, NAME_COLUMNS, range)).toBe("알파\n베타");
});

test("rangeToTsv: 값 안의 탭·줄바꿈은 구분자와 섞이지 않게 공백이 된다", () => {
  const rows = [row({ definitionMd: "첫 줄\n둘째\t줄" })];
  const columns = [columnByKey("definitionMd")];
  expect(rangeToTsv(rows, columns, { r0: 0, r1: 0, c0: 0, c1: 0 })).toBe("첫 줄 둘째 줄");
});

test("planPaste: 한 행의 여러 열은 PATCH 하나로 합쳐진다", () => {
  // 행마다 요청이 한 번이어야 리비전이 한 칸만 올라간다 — 열 수만큼 올라가면
  // 같이 쓰는 사람 화면에는 "다섯 번 고침"으로 남고 이력이 쓸모없어진다.
  const rows = pair();
  const plan = planPaste(rows, NAME_COLUMNS, { r: 0, c: 0 }, [
    ["A", "가"],
    ["B", "나"],
  ]);
  expect(plan.errors).toEqual([]);
  expect(plan.updates).toHaveLength(2);
  expect(plan.updates[0]).toEqual({ rowId: "a", patch: { nameEn: "A", nameKo: "가" } });
  expect(plan.cells).toBe(4);
});

test("planPaste: 표에 남은 줄이 모자라면 버린 만큼 알려 준다", () => {
  const rows = pair();
  const plan = planPaste(rows, NAME_COLUMNS, { r: 1, c: 0 }, [["A"], ["B"], ["C"]]);
  expect(plan.updates).toHaveLength(1);
  expect(plan.errors.join(" ")).toContain("2줄");
});

test("planPaste: 열 밖으로 넘치는 값은 조용히 버린다", () => {
  const rows = pair();
  const plan = planPaste(rows, NAME_COLUMNS, { r: 0, c: 1 }, [["가", "넘침", "더넘침"]]);
  expect(plan.updates).toEqual([{ rowId: "a", patch: { nameKo: "가" } }]);
});

test("planPaste: 읽기 전용 열은 건너뛰고 사유를 남긴다", () => {
  const rows = pair();
  const columns = [columnByKey("nameEn"), columnByKey("slug")];
  const plan = planPaste(rows, columns, { r: 0, c: 0 }, [["A", "new-slug"]]);
  expect(plan.updates).toEqual([{ rowId: "a", patch: { nameEn: "A" } }]);
  expect(plan.errors.join(" ")).toContain("읽기 전용");
});

test("planPaste: 값이 그대로인 셀은 저장 대상이 아니다", () => {
  const rows = pair();
  const plan = planPaste(rows, NAME_COLUMNS, { r: 0, c: 0 }, [["Alpha", " 알파 "]]);
  expect(plan.updates).toEqual([]);
  expect(plan.cells).toBe(0);
});

test("planPaste: 잘못된 값 한 칸이 나머지 칸까지 막지는 않는다", () => {
  const rows = pair();
  const columns = [columnByKey("nameEn"), columnByKey("status")];
  const plan = planPaste(rows, columns, { r: 0, c: 0 }, [["A", "존재하지않음"]]);
  expect(plan.updates).toEqual([{ rowId: "a", patch: { nameEn: "A" } }]);
  expect(plan.errors).toHaveLength(1);
  expect(plan.errors[0]).toContain("존재하지않음");
});

test("planPaste: 표준명을 둘 다 비우는 행은 통째로 빠진다", () => {
  const rows = [row({ id: "a", nameEn: "Alpha", nameKo: null })];
  const plan = planPaste(rows, NAME_COLUMNS, { r: 0, c: 0 }, [[""]]);
  expect(plan.updates).toEqual([]);
  expect(plan.errors.join(" ")).toContain("둘 다 비울 수는 없습니다");
});

test("planFill: 첫 줄 값을 아래로만 복사한다(원본 줄은 건드리지 않는다)", () => {
  const rows = pair();
  const plan = planFill(rows, NAME_COLUMNS, { r0: 0, r1: 1, c0: 0, c1: 0 });
  expect(plan.updates).toEqual([{ rowId: "b", patch: { nameEn: "Alpha" } }]);
});

test("planFill: 한 줄만 선택했으면 아무것도 하지 않는다", () => {
  const plan = planFill(pair(), NAME_COLUMNS, { r0: 0, r1: 0, c0: 0, c1: 1 });
  expect(plan.updates).toEqual([]);
});

test("planClear: 표준명은 null로 비우고 종류·상태는 손대지 않는다", () => {
  const rows = [row({ id: "a", nameEn: "Alpha", nameKo: "알파" })];
  const columns = [columnByKey("nameEn"), columnByKey("status")];
  const plan = planClear(rows, columns, { r0: 0, r1: 0, c0: 0, c1: 1 });
  expect(plan.updates).toEqual([{ rowId: "a", patch: { nameEn: null } }]);
  expect(plan.errors.join(" ")).toContain("비울 수 없어");
});

test("planCell: 셀 하나도 붙여넣기와 같은 계획 모양을 낸다", () => {
  const target = row({ id: "a" });
  const plan = planCell(target, columnByKey("status"), "deprecated");
  expect(plan).toEqual({ updates: [{ rowId: "a", patch: { status: "deprecated" } }], errors: [], cells: 1 });
});

test("inversePatch: 건드린 열만, 지금 값으로 되돌린다", () => {
  const target = row({ nameEn: "Alpha", status: "active", domain: ["ISP"] });
  expect(inversePatch(target, { status: "deprecated" })).toEqual({ status: "active" });
  expect(inversePatch(target, { nameEn: null, status: "deprecated" })).toEqual({
    nameEn: "Alpha",
    status: "active",
  });
});

test("inversePatch: domain은 복사본이라 원본이 바뀌어도 되돌릴 값이 남는다", () => {
  const target = row({ domain: ["ISP"] });
  const back = inversePatch(target, { domain: ["PM"] });
  target.domain.push("RF");
  expect(back.domain).toEqual(["ISP"]);
});

test("clampColumnWidth: 열이 사라지거나 화면 밖으로 나가지 않는다", () => {
  expect(clampColumnWidth(0)).toBe(COLUMN_MIN_WIDTH);
  expect(clampColumnWidth(99999)).toBe(COLUMN_MAX_WIDTH);
  expect(clampColumnWidth(180.6)).toBe(181);
});

test("isDensity: 저장소에서 읽은 아무 값이나 통과시키지 않는다", () => {
  expect(isDensity("compact")).toBe(true);
  expect(isDensity("huge")).toBe(false);
  expect(isDensity(null)).toBe(false);
});

test("rowLabel: 영문 → 국문 → 슬러그 순으로 떨어진다", () => {
  expect(rowLabel(row({ nameEn: "Alpha", nameKo: "알파" }))).toBe("Alpha");
  expect(rowLabel(row({ nameEn: null, nameKo: "알파" }))).toBe("알파");
  expect(rowLabel(row({ nameEn: null, nameKo: null, slug: "alpha" }))).toBe("alpha");
});

test("toggleHiddenColumn: 켰다 끄면 원래대로 돌아온다", () => {
  const off = toggleHiddenColumn([], "domain");
  expect(off).toEqual(["domain"]);
  expect(toggleHiddenColumn(off!, "domain")).toEqual([]);
});

// 마지막 한 열까지 숨기면 표가 빈 화면이 되고, 그 설정이 localStorage에 남아
// 새로고침해도 그대로다 — 되돌릴 창구(머리글 우클릭)까지 같이 사라진다.
test("toggleHiddenColumn: 마지막 남은 열은 숨기지 못한다", () => {
  const allButOne = GRID_COLUMNS.slice(1).map((c) => c.key);
  expect(toggleHiddenColumn(allButOne, GRID_COLUMNS[0]!.key)).toBeNull();
});

test("toggleHiddenColumn: 원본 배열을 건드리지 않는다", () => {
  const hidden = ["domain" as const];
  toggleHiddenColumn(hidden, "slug");
  expect(hidden).toEqual(["domain"]);
});

test("visibleColumns: 숨겼다 켜도 열 순서는 GRID_COLUMNS 그대로다", () => {
  const hidden = toggleHiddenColumn([], "nameKo")!;
  expect(visibleColumns(hidden).map((c) => c.key)).not.toContain("nameKo");
  expect(visibleColumns(toggleHiddenColumn(hidden, "nameKo")!).map((c) => c.key)).toEqual(
    GRID_COLUMNS.map((c) => c.key),
  );
});

test("clampMenuPosition: 화면 안이면 커서 자리 그대로다", () => {
  expect(clampMenuPosition({ x: 300, y: 200 }, { w: 208, h: 300 }, { w: 1280, h: 800 })).toEqual({ x: 300, y: 200 });
});

// 우클릭 메뉴는 fixed라 잘리면 스크롤로도 못 따라간다. 오른쪽 끝 열·아래쪽
// 머리글에서 실제로 일어나는 상황이다.
test("clampMenuPosition: 오른쪽·아래로 넘치면 화면 안으로 접는다", () => {
  const at = clampMenuPosition({ x: 1200, y: 700 }, { w: 208, h: 300 }, { w: 1280, h: 800 });
  expect(at.x + 208).toBeLessThanOrEqual(1280 - MENU_EDGE_GAP + 0.001);
  expect(at.y + 300).toBeLessThanOrEqual(800 - MENU_EDGE_GAP + 0.001);
});

test("clampMenuPosition: 메뉴가 화면보다 커도 왼쪽 위 여백에 붙인다", () => {
  expect(clampMenuPosition({ x: 10, y: 10 }, { w: 400, h: 900 }, { w: 320, h: 600 })).toEqual({
    x: MENU_EDGE_GAP,
    y: MENU_EDGE_GAP,
  });
});
