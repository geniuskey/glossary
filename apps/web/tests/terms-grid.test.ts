import { expect, test } from "vitest";
import { TERM_TYPES } from "../src/lib/terms/enums.js";
import {
  applyPatch,
  cellText,
  columnByKey,
  defaultHiddenColumns,
  GRID_COLUMNS,
  patchForCell,
  rowsToMatrix,
  toCsv,
  toTsv,
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
    status: "draft",
    definitionMd: null,
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

test("patchForCell: 정의를 비우면 빈 문자열이다(null이 아니다)", () => {
  // termInputBaseSchema에서 definitionMd는 nullable이 아니라 optional string이다.
  // 여기서 null을 보내면 400이 된다.
  expect(patchForCell("definitionMd", "  ")).toEqual({ patch: { definitionMd: "" } });
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
  expect(patchForCell("status", "approved")).toEqual({ patch: { status: "approved" } });
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
  expect(wouldClearBothNames(onlyEn, { status: "approved" })).toBe(false);
});

test("applyPatch는 원본을 건드리지 않는다(실패 시 되돌리기가 이것에 의존한다)", () => {
  const original = row();
  const next = applyPatch(original, { status: "approved" });
  expect(next.status).toBe("approved");
  expect(original.status).toBe("draft");
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
  expect(defaultHiddenColumns()).toEqual(["fullNameEn", "fullNameKo"]);
  // 전부 숨겨지면 표가 빈 화면이 된다.
  expect(defaultHiddenColumns().length).toBeLessThan(GRID_COLUMNS.length);
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
    ["Interstitial Slide Point", "draft"],
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
