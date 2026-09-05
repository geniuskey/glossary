import ExcelJS from "exceljs";
import { TERM_STATUS_LABEL, TERM_STATUSES } from "@/lib/terms/enums";
import { ADDITIONAL_SURFACE_FIELDS, IMPORT_COLUMNS, IMPORT_RULES, REQUIREMENT_LABEL, SAMPLE_ROWS } from "./format";

const HEADER_FILL = "FFF1F3F5";
const HEADER_LINE = "FFC6CBD1";
const MUTED = "FF6B7280";

/**
 * 내려받는 샘플 파일. 화면의 설명(import-guide.tsx)과 같은 format.ts를 읽으므로
 * "샘플대로 채웠는데 파서가 못 알아보는" 상태가 구조적으로 불가능하다 —
 * tests/import-template.test.ts가 이 파일을 그대로 파서에 먹여 왕복으로 확인한다.
 *
 * 데이터 시트가 반드시 첫 번째다. 파서는 worksheets[0]만 읽으므로 안내 시트가
 * 앞에 오면 샘플 파일 자신이 "인식 가능한 헤더가 없습니다"로 튕긴다.
 */
export async function buildImportTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Glossary";
  wb.created = new Date();

  addDataSheet(wb);
  addGuideSheet(wb);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function addDataSheet(wb: ExcelJS.Workbook): void {
  // 1행이 열 이름이라 얼어붙여 둔다 — 수백 행을 채우는 동안 어느 열인지
  // 계속 보이는 것이 이 파일에서 제일 실용적인 장치다.
  const ws = wb.addWorksheet("용어", { views: [{ state: "frozen", ySplit: 1 }] });

  const header = ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin", color: { argb: HEADER_LINE } } };
    cell.alignment = { vertical: "middle" };
  });

  for (const sample of SAMPLE_ROWS) {
    const row = ws.addRow(IMPORT_COLUMNS.map((c) => sample[c.field]));
    row.alignment = { vertical: "top", wrapText: true };
  }

  IMPORT_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
}

function addGuideSheet(wb: ExcelJS.Workbook): void {
  // 파일은 화면을 떠나서 돌아다닌다 — 받아 본 사람이 /import를 한 번도 안 봤을
  // 수 있으므로 규칙을 파일 안에도 넣는다.
  const ws = wb.addWorksheet("작성 안내");
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 62;

  title(ws, "작성 안내");
  ws.addRow([]);

  for (const line of IMPORT_RULES) {
    const row = ws.addRow([`· ${line}`]);
    ws.mergeCells(row.number, 1, row.number, 4);
  }

  ws.addRow([]);
  table(
    ws,
    ["추가 표기 입력", "용도", "", ""],
    ADDITIONAL_SURFACE_FIELDS.map((field) => {
      const column = IMPORT_COLUMNS.find((candidate) => candidate.field === field)!;
      return [column.header, column.hint, "", ""];
    }),
  );

  ws.addRow([]);
  table(
    ws,
    ["열 이름", "이렇게 적어도 됩니다", "필수", "설명"],
    IMPORT_COLUMNS.map((c) => [
      c.header,
      c.otherHeaders.join(", "),
      REQUIREMENT_LABEL[c.requirement],
      c.hint,
    ]),
  );

  ws.addRow([]);
  table(
    ws,
    ["상태에 쓸 수 있는 값", "뜻", "", ""],
    TERM_STATUSES.map((s) => [s, TERM_STATUS_LABEL[s], "", ""]),
  );
}

function title(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow([text]);
  row.getCell(1).font = { bold: true, size: 14 };
}

function table(ws: ExcelJS.Worksheet, headers: string[], body: string[][]): void {
  const header = ws.addRow(headers);
  header.eachCell((cell) => {
    if (!cell.value) return;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
  for (const line of body) {
    const row = ws.addRow(line);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).font = { color: { argb: MUTED } };
  }
}
