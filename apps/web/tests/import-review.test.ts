import { beforeEach, expect, test, vi } from "vitest";
import ExcelJS from "exceljs";
import { DEFAULT_SPLIT_OPTIONS, needsReview, splitSurfaceCell, reviewColumns, type ReviewOptionalColumn } from "../src/lib/import/review";

const mocks = vi.hoisted(() => ({ createTerm: vi.fn(), findDuplicates: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@/lib/terms/create", () => ({ createTerm: mocks.createTerm, findDuplicates: mocks.findDuplicates }));
vi.mock("@/lib/auth/require", () => ({ requireAuth: mocks.requireAuth, isResponse: (value: unknown) => value instanceof Response }));
vi.mock("@/lib/terms/categories", () => ({ listBusinessCategories: async () => [] }));
import { POST } from "../src/app/api/v1/import/review/route";
import type { ReviewReport } from "../src/lib/import/review";

beforeEach(() => {
  mocks.createTerm.mockReset().mockResolvedValue({});
  mocks.findDuplicates.mockReset().mockResolvedValue([]);
  mocks.requireAuth.mockReset().mockResolvedValue({ kind: "key", keyId: "test-key" });
});

async function request(text: string, report?: ReviewReport, apply = false, columns: ReviewOptionalColumn[] = []) {
  const body = new FormData();
  body.set("text", text);
  body.set("review", JSON.stringify({ options: DEFAULT_SPLIT_OPTIONS, columns, decisions: report?.rows ?? [] }));
  body.set("apply", String(apply));
  return POST(new Request("http://localhost/api/v1/import/review", { method: "POST", body }));
}

test("commas, semicolons and line breaks split; parentheses and quotes retain literal punctuation", () => {
  expect(splitSurfaceCell('AE; Auto Exposure\nExposure (Auto, Manual); "A,B"').values)
    .toEqual(["AE", "Auto Exposure", "Exposure (Auto, Manual)", '"A,B"']);
  expect(splitSurfaceCell("AE, Auto Exposure").reasons).toHaveLength(1);
  expect(splitSurfaceCell("AE, Auto Exposure", { ...DEFAULT_SPLIT_OPTIONS, comma: false }).values).toEqual(["AE, Auto Exposure"]);
  expect(splitSurfaceCell("AE; AE; ").values).toEqual(["AE"]);
  expect(splitSurfaceCell("AE (Auto, Exposure").reasons).toHaveLength(1);
});

test("headerless paste preserves source, chooses first names and saves other spellings as aliases", async () => {
  const source = "AE; Auto Exposure\t자동 노출; 자동노출";
  const preview = await (await request(source)).json();
  expect(preview.report.rows[0]).toMatchObject({ rowNumber: 1, originalEn: "AE; Auto Exposure", en: ["AE", "Auto Exposure"], ko: ["자동 노출", "자동노출"] });
  expect(mocks.createTerm).not.toHaveBeenCalled();
  const result = await (await request(source, preview.report, true)).json();
  expect(result.created).toBe(1);
  expect(mocks.createTerm.mock.calls[0]![0]).toMatchObject({ nameEn: "AE", nameKo: "자동 노출", surfaces: [
    { text: "Auto Exposure", kind: "alias" }, { text: "자동노출", kind: "alias" },
  ] });
  expect(mocks.createTerm.mock.calls[0]!.slice(1)).toEqual([null, "test-key"]);
});

test("ambiguous rows require individual approval; an edited row cannot reuse its approval", async () => {
  const source = "영문\t한글\nAE, Auto Exposure\t자동 노출";
  const { report } = await (await request(source)).json() as { report: ReviewReport };
  expect(needsReview(report.rows[0]!)).toBe(true);
  expect((await (await request(source, report, true)).json()).needsReview).toBe(true);
  expect(mocks.createTerm).not.toHaveBeenCalled();
  report.rows[0]!.approval = report.rows[0]!.fingerprint;
  report.rows[0]!.en = ["Auto Exposure", "AE"];
  const changed = await (await request(source, report, true)).json();
  expect(changed.needsReview).toBe(true);
  changed.report.rows[0].approval = changed.report.rows[0].fingerprint;
  expect((await (await request(source, changed.report, true)).json()).created).toBe(1);
  expect(mocks.createTerm.mock.calls[0]![0].nameEn).toBe("Auto Exposure");
});

test("new database conflicts revoke approvals and duplicate rows are never automatically merged", async () => {
  const source = "영문\t한글\nAE; Auto Exposure\t자동 노출\nAE; Acoustic Emission\t음향 방출";
  const { report } = await (await request(source)).json() as { report: ReviewReport };
  expect(report.rows.every(needsReview)).toBe(true);
  report.rows.forEach((row) => { row.approval = row.fingerprint; });
  mocks.findDuplicates.mockResolvedValue([{ normLoose: "ae", conflictingSlug: "existing-ae" }]);
  const checked = await (await request(source, report, true)).json();
  expect(checked.needsReview).toBe(true);
  expect(mocks.createTerm).not.toHaveBeenCalled();
  checked.report.rows.forEach((row: ReviewReport["rows"][number]) => { row.approval = row.fingerprint; });
  expect((await (await request(source, checked.report, true)).json()).created).toBe(2);
});

test("invalid rows can be fixed or skipped without blocking the remaining input", async () => {
  const source = "영문\t한글\n---\t\nDatabase\t데이터베이스";
  const { report } = await (await request(source)).json() as { report: ReviewReport };
  expect(report.rows[0]!.errors.length).toBeGreaterThan(0);
  report.rows[0]!.skip = true;
  expect((await (await request(source, report, true)).json()).created).toBe(1);
});

test("workbooks and pasted tables produce the same review", async () => {
  const source = "영문\t한글\nAE, Auto Exposure\t자동 노출; 자동노출";
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("terms");
  source.split("\n").forEach((line) => sheet.addRow(line.split("\t")));
  const body = new FormData();
  body.set("file", new File([await workbook.xlsx.writeBuffer() as ArrayBuffer], "terms.xlsx"));
  body.set("review", JSON.stringify({ options: DEFAULT_SPLIT_OPTIONS, decisions: [] }));
  const workbookResult = await (await POST(new Request("http://localhost/api/v1/import/review", { method: "POST", body }))).json();
  expect(workbookResult.report).toEqual((await (await request(source)).json()).report);
});

test("2000 rows are reviewed with one duplicate lookup", async () => {
  const source = ["영문\t한글", ...Array.from({ length: 2000 }, (_, i) => `Term ${i}; Variant ${i}\t용어 ${i}`)].join("\n");
  const { report } = await (await request(source)).json();
  expect(report.rows).toHaveLength(2000);
  expect(mocks.findDuplicates).toHaveBeenCalledTimes(1);
  expect(report.rows.every((row: ReviewReport["rows"][number]) => !needsReview(row))).toBe(true);
});

test("partial saves return completed source rows and stop at the first failure", async () => {
  mocks.createTerm.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("database unavailable"));
  const result = await (await request("One\t하나\nTwo\t둘\nThree\t셋", undefined, true)).json();
  expect(result).toMatchObject({ created: 1, completed: [1], failures: [{ rowNumber: 2 }] });
  expect(mocks.createTerm).toHaveBeenCalledTimes(2);
});

test("authentication and forged row numbers are rejected", async () => {
  const { report } = await (await request("One\t하나")).json() as { report: ReviewReport };
  report.rows[0]!.rowNumber = 99;
  expect((await request("One\t하나", report, true)).status).toBe(400);
  mocks.requireAuth.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await request("One\t하나")).status).toBe(401);
  expect(mocks.createTerm).not.toHaveBeenCalled();
});

test("duplicate headers are reported instead of silently losing a column", async () => {
  const result = await (await request("영문\t영문\nOne\tTwo")).json();
  expect(result.report.fileErrors).toHaveLength(1);
  expect(result.report.rows).toHaveLength(0);
});

test("optional columns follow a fixed order regardless of checkbox selection order", () => {
  expect(reviewColumns(["bodyMd", "domain", "definitionMd"]).map((column) => column.key))
    .toEqual(["nameEn", "nameKo", "domain", "definitionMd", "bodyMd"]);
  expect(reviewColumns(["bodyMd"]).map((column) => column.key)).toEqual(["nameEn", "nameKo", "bodyMd"]);
});

test("selected optional columns reach preview and save without splitting markdown or multiline body", async () => {
  const source = 'Database\t데이터베이스\tSW, IT\t자료를 저장; 관리하는 곳\t"## 설명\n첫 문단, 둘째 문단; 그대로"';
  const columns: ReviewOptionalColumn[] = ["bodyMd", "domain", "definitionMd"];
  const { report } = await (await request(source, undefined, false, columns)).json();
  expect(report.rows[0]).toMatchObject({ domain: ["SW", "IT"], definitionMd: "자료를 저장; 관리하는 곳", bodyMd: "## 설명\n첫 문단, 둘째 문단; 그대로" });
  expect((await (await request(source, report, true, columns)).json()).created).toBe(1);
  expect(mocks.createTerm.mock.calls[0]![0]).toMatchObject({ domain: ["SW", "IT"], definitionMd: "자료를 저장; 관리하는 곳", bodyMd: "## 설명\n첫 문단, 둘째 문단; 그대로" });
});

test("body-only selection maps the third column to body, not domain", async () => {
  const source = "Database\t데이터베이스\t# 본문";
  expect((await request(source)).status).toBe(400);
  const { report } = await (await request(source, undefined, false, ["bodyMd"])).json();
  expect(report.rows[0]).toMatchObject({ domain: [], bodyMd: "# 본문" });
});

test("workbook optional columns are opt-in and both language headers are required", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("terms");
  sheet.addRow(["영문", "한글", "본문", "도메인", "한줄 정의"]);
  sheet.addRow(["Database", "데이터베이스", "# 내용\n첫째; 둘째", "SW, IT", "자료 모음"]);
  async function inspect(columns: ReviewOptionalColumn[]) {
    const body = new FormData();
    body.set("file", new File([await workbook.xlsx.writeBuffer() as ArrayBuffer], "terms.xlsx"));
    body.set("review", JSON.stringify({ options: DEFAULT_SPLIT_OPTIONS, columns, decisions: [] }));
    return (await POST(new Request("http://localhost/api/v1/import/review", { method: "POST", body }))).json();
  }
  const unselected = await inspect([]);
  expect(unselected.report.rows[0].bodyMd).toBeUndefined();
  expect(unselected.report.ignoredHeaders).toEqual(["본문", "도메인", "한줄 정의"]);
  const selected = await inspect(["domain", "bodyMd", "definitionMd"]);
  expect(selected.report.rows[0]).toMatchObject({ domain: ["SW", "IT"], definitionMd: "자료 모음", bodyMd: "# 내용\n첫째; 둘째" });
  expect(selected.report.ignoredHeaders).toEqual([]);
  sheet.getCell("B1").value = "잘못된 열";
  expect((await inspect([])).report.fileErrors[0].message).toContain("두 열이 모두 필요");
});

test("metadata changes invalidate an existing ambiguous-row approval", async () => {
  const original = "AE, Auto Exposure\t자동 노출\t기존 본문";
  const { report } = await (await request(original, undefined, false, ["bodyMd"])).json();
  report.rows[0].approval = report.rows[0].fingerprint;
  const result = await (await request(original.replace("기존 본문", "수정 본문"), report, true, ["bodyMd"])).json();
  expect(result.needsReview).toBe(true);
  expect(mocks.createTerm).not.toHaveBeenCalled();
});

test("approved file-row merge saves one concept with both spellings and bodies", async () => {
  const source = "AE\t자동 노출\t대표 본문\nAuto Exposure\t자동노출\t추가 본문";
  const first = await (await request(source, undefined, false, ["bodyMd"])).json();
  first.report.rows[1].mergeIntoRow = 1;
  const preview = await (await request(source, first.report, false, ["bodyMd"])).json();
  expect(preview.report.rows[0].mergePreview).toContain("추가 본문");
  expect((await (await request(source, preview.report, true, ["bodyMd"])).json()).needsReview).toBe(true);
  for (const row of preview.report.rows) row.approval = row.fingerprint;
  const result = await (await request(source, preview.report, true, ["bodyMd"])).json();
  expect(result.created).toBe(1); expect(result.completed).toEqual([1, 2]);
  expect(mocks.createTerm).toHaveBeenCalledTimes(1);
  const saved = mocks.createTerm.mock.calls[0]![0];
  expect(saved.bodyMd).toBe("대표 본문\n\n추가 본문");
  expect(saved.surfaces.map((s: { text: string }) => s.text)).toContain("Auto Exposure");
});

test("merge cycles and skipped targets block saving", async () => {
  const source = "AA\t가\nBB\t나";
  const first = await (await request(source)).json();
  first.report.rows[0].mergeIntoRow = 2;
  first.report.rows[1].mergeIntoRow = 1;
  const cyclic = await (await request(source, first.report, true)).json();
  expect(cyclic.needsReview).toBe(true);
  expect(cyclic.report.rows[0].errors.length).toBeGreaterThan(0);
  delete first.report.rows[1].mergeIntoRow;
  first.report.rows[1].skip = true;
  const skipped = await (await request(source, first.report, true)).json();
  expect(skipped.needsReview).toBe(true);
  expect(mocks.createTerm).not.toHaveBeenCalled();
});
