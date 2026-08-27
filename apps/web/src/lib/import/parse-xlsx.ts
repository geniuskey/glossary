import ExcelJS from "exceljs";

export interface ImportRow {
  rowNumber: number;
  termType: "term" | "abbreviation" | "project" | "product_id" | "code" | "unit";
  nameEn?: string;
  nameKo?: string;
  fullNameEn?: string;
  fullNameKo?: string;
  domain: string[];
  status: "draft" | "approved" | "deprecated" | "forbidden";
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
  /** R124: HEADER_ALIASES에 없어 무시된 헤더 원문(등장 순서, 중복 제거). */
  ignoredHeaders: string[];
}

const TERM_TYPES = new Set(["term", "abbreviation", "project", "product_id", "code", "unit"]);
const STATUSES = new Set(["draft", "approved", "deprecated", "forbidden"]);

const HEADER_ALIASES: Record<string, keyof ImportRow | "aliases"> = {
  name_en: "nameEn",
  영문: "nameEn",
  영문명: "nameEn",
  english: "nameEn",
  name_ko: "nameKo",
  한글: "nameKo",
  한글명: "nameKo",
  korean: "nameKo",
  full_name_en: "fullNameEn",
  풀네임: "fullNameEn",
  전체명: "fullNameEn",
  full_name_ko: "fullNameKo",
  term_type: "termType",
  종류: "termType",
  유형: "termType",
  domain: "domain",
  도메인: "domain",
  status: "status",
  상태: "status",
  definition: "definitionMd",
  정의: "definitionMd",
  설명: "definitionMd",
  aliases: "aliases",
  별칭: "aliases",
  약칭: "aliases",
};

function splitList(value: string): string[] {
  return value
    .split(",")
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

  const columnMap = new Map<number, keyof ImportRow | "aliases">();
  const ignoredHeaders: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    const raw = cellText(cell.value);
    if (!raw) return;
    const key = raw.toLowerCase().replace(/\s+/g, "_");
    const mapped = HEADER_ALIASES[key];
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

    const termType = TERM_TYPES.has(raw.termType ?? "") ? (raw.termType as ImportRow["termType"]) : "term";
    const status = STATUSES.has(raw.status ?? "") ? (raw.status as ImportRow["status"]) : "draft";

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
