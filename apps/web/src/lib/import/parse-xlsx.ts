import ExcelJS from "exceljs";
import { TERM_STATUSES, TERM_TYPES, type TermStatusLiteral, type TermTypeLiteral } from "@/lib/terms/enums";
import { HEADER_TO_FIELD, LIST_SEPARATOR, normalizeHeader, type ImportField } from "./format";

export interface ImportRow {
  rowNumber: number;
  termType: TermTypeLiteral;
  nameEn?: string;
  nameKo?: string;
  fullNameEn?: string;
  fullNameKo?: string;
  domain: string[];
  status: TermStatusLiteral;
  definitionMd?: string;
  aliases: string[];
}

/** 특정 행에서 발생한 실패. rowNumber는 워크시트의 실제 행 번호(1-base)다. */
export interface RowError {
  rowNumber: number;
  message: string;
}

/**
 * R122: "시트를 찾을 수 없습니다"/"인식 가능한 헤더가 없습니다"는 행 단위
 * 실패가 아니다 — 아직 행이라는 개념 자체가 성립하지 않는 파일 단위 실패다.
 * 계획서 스케치는 이걸 rowNumber 0/1을 붙여 RowError로 흘려보내는데, 그러면
 * `total = rows.length + errors.length` 계산과 "N행 중 M행 등록 가능" 문구가
 * "그 파일에 실제로 몇 번째 행이 잘못됐는지"를 암시하게 되어 거짓말이 된다.
 * 별도 타입으로 분리해 total 계산에서 아예 빼고, 화면에는 "파일 자체를 읽을
 * 수 없습니다" 같은 별도 섹션으로 보여준다.
 */
export interface FileError {
  message: string;
}

export interface ParseResult {
  rows: ImportRow[];
  errors: RowError[];
  fileErrors: FileError[];
  /** R124: 인정하는 헤더가 아니어서 무시된 헤더 원문(등장 순서, 중복 제거). */
  ignoredHeaders: string[];
}

// 인정하는 값 목록은 enums.ts 하나만 본다 — 여기에 리터럴을 다시 적으면 DB
// enum과의 드리프트를 막는 tests/terms-enums.test.ts의 사정권 밖에 놓인다.
const TERM_TYPE_SET = new Set<string>(TERM_TYPES);
const STATUS_SET = new Set<string>(TERM_STATUSES);

function splitList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((v) => v.trim())
    .filter(Boolean);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  return String(value).trim();
}

export async function parseGlossaryWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets[0];
  if (!ws) {
    return { rows: [], errors: [], fileErrors: [{ message: "시트를 찾을 수 없습니다." }], ignoredHeaders: [] };
  }

  const columnMap = new Map<number, ImportField>();
  const ignoredHeaders: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    const raw = cellText(cell.value);
    if (!raw) return;
    const mapped = HEADER_TO_FIELD[normalizeHeader(raw)];
    if (mapped) columnMap.set(col, mapped);
    // R124: 관대한 매핑 자체는 유지하되(기존 엑셀이 어떤 헤더를 쓰는지 미리
    // 알 수 없다는 근거가 타당하다), 못 알아본 헤더는 조용히 사라지지 않고
    // 리포트에 남는다 — dry-run의 존재 이유가 "무엇이 유실되는지 미리
    // 보여주는 것"이다.
    else if (!ignoredHeaders.includes(raw)) ignoredHeaders.push(raw);
  });

  if (columnMap.size === 0) {
    return {
      rows: [],
      errors: [],
      fileErrors: [{ message: "인식 가능한 헤더가 없습니다." }],
      ignoredHeaders,
    };
  }

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const raw: Record<string, string> = {};
    for (const [col, field] of columnMap) raw[field] = cellText(row.getCell(col).value);

    // R123: exceljs의 기본 eachRow는 셀이 하나도 설정되지 않은 행 자체를
    // 방문하지 않으므로, "완전히 빈 행"은 이 콜백에 아예 도달하지 않는다.
    // 이 가드가 실제로 의미를 갖는 경우는 "매핑된 칸에는 값이 있어(그래서
    // eachRow가 방문했지만) 전부 빈 문자열인" 행이다(예: 서식만 남기고 내용을
    // 지운 셀). tests/import-parse.test.ts가 정확히 이 시나리오로 이 줄을
    // 지우면 실패하는지 직접 확인했다 — 계획서가 준 원래 테스트(완전히 빈
    // `[]` 행)는 exceljs가 아예 방문하지 않아 이 줄과 무관하게 통과해
    // 공허했다.
    if (Object.values(raw).every((v) => v === "")) return;

    const nameEn = raw.nameEn || undefined;
    const nameKo = raw.nameKo || undefined;
    if (!nameEn && !nameKo) {
      errors.push({ rowNumber, message: "영문 또는 한글 표준 표기가 필요합니다." });
      return;
    }

    const termType = TERM_TYPE_SET.has(raw.termType ?? "") ? (raw.termType as TermTypeLiteral) : "term";
    const status = STATUS_SET.has(raw.status ?? "") ? (raw.status as TermStatusLiteral) : "draft";

    rows.push({
      rowNumber,
      termType,
      nameEn,
      nameKo,
      fullNameEn: raw.fullNameEn || undefined,
      fullNameKo: raw.fullNameKo || undefined,
      domain: splitList(raw.domain ?? ""),
      status,
      definitionMd: raw.definitionMd || undefined,
      aliases: splitList(raw.aliases ?? ""),
    });
  });

  return { rows, errors, fileErrors: [], ignoredHeaders };
}
