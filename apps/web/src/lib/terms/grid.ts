import {
  TERM_STATUSES,
  TERM_STATUS_LABEL,
  TERM_TYPES,
  TERM_TYPE_LABEL,
  type TermStatusLiteral,
  type TermTypeLiteral,
} from "./enums";

// R114와 같은 이유로 이 모듈은 @grossary/db를 import하지 않는다 — terms-grid.tsx
// (Client Component)가 여기서 타입과 컬럼 정의를 가져가기 때문이다. 대신 서버
// 쪽(query.ts)이 이 모듈의 TermRow/SortKey를 자기 select의 계약으로 삼는다.
// 방향을 이렇게 잡아야 "화면이 요구하는 모양"이 한 곳에만 적힌다.

/**
 * 표 한 줄. TermSummary(공개 API 계약)와 일부러 분리했다 — 표는 협업 화면이라
 * "누가 언제 고쳤는지"와 낙관적 동시성에 필요한 revision이 반드시 필요한데,
 * 그 필드를 TermSummary에 넣으면 GET /api/v1/terms 응답 모양이 함께 바뀐다.
 */
export interface TermRow {
  id: string;
  slug: string;
  termType: TermTypeLiteral;
  nameEn: string | null;
  nameKo: string | null;
  fullNameEn: string | null;
  fullNameKo: string | null;
  domain: string[];
  status: TermStatusLiteral;
  definitionMd: string | null;
  bodyMd: string | null;
  /** ISO 문자열. Server Component에서 Client Component로 Date를 넘길 수 없다. */
  updatedAt: string;
  editorName: string | null;
  /** 이 행의 현재 리비전 번호. 셀 저장 시 expectedRevision으로 그대로 보낸다. */
  revision: number;
}

export const SORT_KEYS = ["updatedAt", "nameEn", "nameKo", "slug", "termType", "status"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

export const DEFAULT_SORT: SortKey = "updatedAt";
export const DEFAULT_DIR: SortDir = "desc";

export type ColumnKey =
  | "nameEn"
  | "nameKo"
  | "fullNameEn"
  | "fullNameKo"
  | "termType"
  | "status"
  | "domain"
  | "definitionMd"
  | "bodyMd"
  | "slug"
  | "updatedAt";

/**
 * "longtext"는 한 줄 입력창이 아니라 여러 줄 상자로 여는 열이다. 정의·본문을
 * 한 줄짜리 input에 넣으면 앞 몇 글자 말고는 볼 수가 없어서, 셀에서 고칠 수
 * 있다는 사실 자체가 무의미해진다.
 */
export type CellKind = "text" | "enum" | "list" | "longtext" | "readonly";

export interface GridColumn {
  key: ColumnKey;
  label: string;
  kind: CellKind;
  width: number;
  options?: readonly { value: string; label: string }[];
  sortKey?: SortKey;
  mono?: boolean;
  /** 기본으로 숨기는 열. 열 개수가 많아 처음부터 다 펼치면 가로 스크롤만 남는다. */
  hiddenByDefault?: boolean;
}

const TYPE_OPTIONS = TERM_TYPES.map((v) => ({ value: v, label: TERM_TYPE_LABEL[v] }));
const STATUS_OPTIONS = TERM_STATUSES.map((v) => ({ value: v, label: TERM_STATUS_LABEL[v] }));

export const GRID_COLUMNS: readonly GridColumn[] = [
  { key: "nameEn", label: "영문 표준명", kind: "text", width: 200, sortKey: "nameEn" },
  { key: "nameKo", label: "국문 표준명", kind: "text", width: 180, sortKey: "nameKo" },
  { key: "fullNameEn", label: "영문 풀네임", kind: "text", width: 220 },
  { key: "fullNameKo", label: "국문 풀네임", kind: "text", width: 200 },
  { key: "termType", label: "종류", kind: "enum", width: 110, options: TYPE_OPTIONS, sortKey: "termType" },
  { key: "status", label: "상태", kind: "enum", width: 100, options: STATUS_OPTIONS, sortKey: "status" },
  { key: "domain", label: "도메인", kind: "list", width: 160 },
  { key: "definitionMd", label: "정의", kind: "longtext", width: 300 },
  // 본문은 문서 한 편이 통째로 들어가는 칸이라 기본으로는 접어 둔다 — 켜 두면
  // 모든 줄이 마크다운 덩어리가 되어 표를 훑는 일 자체가 안 된다. 열 메뉴에서
  // 켜면 정의와 같은 여러 줄 상자로 고칠 수 있다.
  { key: "bodyMd", label: "본문", kind: "longtext", width: 300, hiddenByDefault: true },
  { key: "slug", label: "슬러그", kind: "readonly", width: 170, mono: true, sortKey: "slug" },
  { key: "updatedAt", label: "최근 수정", kind: "readonly", width: 150, sortKey: "updatedAt" },
];

export function columnByKey(key: ColumnKey): GridColumn {
  const found = GRID_COLUMNS.find((c) => c.key === key);
  if (!found) throw new Error(`unknown column: ${key}`);
  return found;
}

export function defaultHiddenColumns(): ColumnKey[] {
  return GRID_COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.key);
}

/** 보이는 열. 순서는 언제나 GRID_COLUMNS의 순서다(숨겼다 켜도 자리가 바뀌지 않는다). */
export function visibleColumns(hidden: readonly ColumnKey[]): GridColumn[] {
  return GRID_COLUMNS.filter((c) => !hidden.includes(c.key));
}

/**
 * 열 하나를 켜고 끈다. 마지막 한 열까지 끄면 표가 빈 화면이 되는데, 그 설정은
 * localStorage에 남아 새로고침해도 그대로다 — 되돌릴 창구(머리글 우클릭)까지
 * 같이 사라진다. 그래서 그 편집은 만들지 않고 null(바뀐 것 없음)로 답한다.
 */
export function toggleHiddenColumn(hidden: readonly ColumnKey[], key: ColumnKey): ColumnKey[] | null {
  const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  if (next.length >= GRID_COLUMNS.length) return null;
  return next;
}

/** 커서 옆에 여는 메뉴가 화면 끝에 닿았을 때 남길 여백. */
export const MENU_EDGE_GAP = 8;

/**
 * 우클릭 메뉴는 커서 자리에서 열리므로 표 오른쪽 끝·아래쪽 머리글에서는 그대로
 * 두면 화면 밖으로 잘린다(스크롤로도 못 따라간다 — fixed다). 넘치는 쪽만 접는다.
 * 메뉴가 화면보다 크면 위/왼쪽 끝에 붙인다 — 그쪽이 항목의 시작이라 최소한
 * 무엇이 열렸는지는 보인다.
 */
export function clampMenuPosition(
  point: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.max(MENU_EDGE_GAP, Math.min(point.x, viewport.w - size.w - MENU_EDGE_GAP)),
    y: Math.max(MENU_EDGE_GAP, Math.min(point.y, viewport.h - size.h - MENU_EDGE_GAP)),
  };
}

/**
 * 클릭 한 번으로 편집기가 열리는 열. 종류·상태는 고를 목록이 있고 정의·본문은
 * 칸보다 긴 글이라, "선택했다가 다시 눌러야 열린다"는 규칙이 그 세 종류에서는
 * 그냥 한 번의 헛클릭이다. 나머지 열은 드래그로 범위를 잡아 복사·붙여넣기해야
 * 하므로 클릭은 선택으로 남겨 둔다.
 */
export function opensOnClick(column: GridColumn): boolean {
  return column.kind === "enum" || column.kind === "longtext";
}

/** 위아래 경계. 화면 좌표라 top이 작을수록 위다. */
export interface Bounds {
  top: number;
  bottom: number;
}

/**
 * 셀 밖으로 펼쳐지는 편집기(목록·도메인 후보·긴 글 상자)를 위로 열지.
 *
 * 행 번호로 짐작하면("아래에서 넷째 행부터는 위로") 표가 세 줄뿐일 때 첫 행도
 * "아래쪽 행"이 되어 위로 열린다. 위에는 공간이 없으니 목록은 스크롤 상자에
 * 통째로 잘려 나가고 삐져나온 그림자만 회색으로 번져 보인다 — 눌러도 아무 일이
 * 없는 것처럼 보이는 상태가 된다.
 *
 * 아래가 모자랄 때, 그리고 위에는 통째로 들어갈 때만 뒤집는다. 양쪽 다
 * 모자라면 아래로 연다 — 아래로 삐져나온 부분은 표를 굴려서 마저 볼 수 있지만
 * 위로 삐져나온 부분은 영영 닿을 수 없다.
 */
export function opensUp(height: number, cell: Bounds, clip: Bounds): boolean {
  const below = clip.bottom - cell.bottom;
  const above = cell.top - clip.top;
  return height > below && height <= above;
}

/** 셀에 보여주는(그리고 편집을 시작할 때 입력창에 채우는) 문자열. */
export function cellText(row: TermRow, key: ColumnKey): string {
  if (key === "domain") return row.domain.join(", ");
  if (key === "updatedAt") return row.updatedAt;
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export type CellPatch = Partial<
  Pick<
    TermRow,
    | "nameEn"
    | "nameKo"
    | "fullNameEn"
    | "fullNameKo"
    | "termType"
    | "status"
    | "domain"
    | "definitionMd"
    | "bodyMd"
  >
>;

/**
 * 셀에 입력된 원시 문자열을 PATCH 본문 조각으로 바꾼다. 실패는 예외가 아니라
 * 판별 유니온으로 돌려준다 — 표에서는 한 셀이 잘못돼도 나머지 편집은 계속
 * 되어야 하므로, 호출자가 그 셀에만 오류 표시를 남길 수 있어야 한다.
 *
 * 빈 값의 의미가 필드마다 다르다: 표준명/풀네임은 "지운다"(null)이고,
 * 정의는 빈 문자열이다(termInputBaseSchema에서 definitionMd는 nullable이 아니다).
 */
export function patchForCell(key: ColumnKey, raw: string): { patch: CellPatch } | { error: string } {
  const value = raw.trim();

  switch (key) {
    case "nameEn":
    case "nameKo":
    case "fullNameEn":
    case "fullNameKo":
      return { patch: { [key]: value === "" ? null : value } };

    case "definitionMd":
      return { patch: { definitionMd: value } };

    case "bodyMd":
      return { patch: { bodyMd: value } };

    case "domain": {
      // 엑셀에서 붙여넣으면 쉼표와 줄바꿈이 섞여 들어온다. 둘 다 구분자로 보고
      // 빈 항목과 중복을 없앤다(도메인 배열에 같은 값이 두 번 들어가면
      // arrayContains 필터가 같은 용어를 두 번 세지는 않지만 화면이 지저분해진다).
      const items = [...new Set(value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
      return { patch: { domain: items } };
    }

    case "termType": {
      const found = TERM_TYPES.find((t) => t === value);
      if (!found) return { error: `종류 값이 올바르지 않습니다: ${raw}` };
      return { patch: { termType: found } };
    }

    case "status": {
      const found = TERM_STATUSES.find((s) => s === value);
      if (!found) return { error: `상태 값이 올바르지 않습니다: ${raw}` };
      return { patch: { status: found } };
    }

    case "slug":
    case "updatedAt":
      return { error: "이 열은 수정할 수 없습니다." };
  }
}

/** 서버 응답을 기다리지 않고 화면에 먼저 반영할 때 쓴다(실패하면 되돌린다). */
export function applyPatch(row: TermRow, patch: CellPatch): TermRow {
  return { ...row, ...patch };
}

/**
 * 표준명이 둘 다 비면 그 용어는 어떤 이름으로도 불릴 수 없게 된다. 서버도
 * 같은 것을 막지만(update.ts), 왕복 한 번을 기다렸다가 셀이 되돌아가는 것보다
 * 입력 즉시 알려주는 편이 표 편집에서는 훨씬 덜 답답하다.
 */
export function wouldClearBothNames(row: TermRow, patch: CellPatch): boolean {
  const next = applyPatch(row, patch);
  return !next.nameEn && !next.nameKo;
}

// --- 내보내기 -------------------------------------------------------------

function exportValue(row: TermRow, col: GridColumn): string {
  if (col.key === "updatedAt") return row.updatedAt;
  return cellText(row, col.key);
}

export function rowsToMatrix(rows: readonly TermRow[], columns: readonly GridColumn[]): string[][] {
  return [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => exportValue(r, c)))];
}

/** 클립보드용. 탭과 줄바꿈은 열/행 구분자라서 값 안에 있으면 공백으로 바꾼다. */
export function toTsv(rows: readonly TermRow[], columns: readonly GridColumn[]): string {
  return rowsToMatrix(rows, columns)
    .map((line) => line.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}

/** RFC4180. 엑셀이 한글을 깨뜨리지 않도록 저장할 때 BOM을 앞에 붙인다. */
export function toCsv(rows: readonly TermRow[], columns: readonly GridColumn[]): string {
  return rowsToMatrix(rows, columns)
    .map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

// --- 표시 밀도 / 열 너비 ---------------------------------------------------

export const DENSITIES = ["compact", "normal", "roomy"] as const;
export type Density = (typeof DENSITIES)[number];

// F6/P1: 조회표는 Record<유니온, T>로 두고 ?? 기본값을 두지 않는다. 밀도가
// 하나 늘었는데 여기를 빠뜨리면 화면이 아니라 tsc에서 먼저 걸려야 한다.
export const DENSITY_LABEL: Record<Density, string> = {
  compact: "촘촘",
  normal: "보통",
  roomy: "여유",
};
export const DENSITY_ROW_PX: Record<Density, number> = { compact: 26, normal: 32, roomy: 44 };

export function isDensity(value: unknown): value is Density {
  return DENSITIES.some((d) => d === value);
}

export const COLUMN_MIN_WIDTH = 72;
export const COLUMN_MAX_WIDTH = 720;

/** 열을 0px까지 줄여 사라지게 하거나 화면 밖으로 밀어내지 못하게 막는다. */
export function clampColumnWidth(px: number): number {
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, Math.round(px)));
}

/** 오류 문구에서 "어느 줄인지"를 가리키는 이름. 표준명이 없으면 슬러그로 떨어진다. */
export function rowLabel(row: TermRow): string {
  return row.nameEn ?? row.nameKo ?? row.slug;
}

// --- 선택 영역 -------------------------------------------------------------

/** 화면에 보이는 좌표다(숨긴 열을 걸러낸 뒤의 인덱스). */
export interface CellRef {
  r: number;
  c: number;
}

export interface CellRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** 두 좌표로 만든 직사각형. 어느 쪽을 먼저 찍었든 같은 범위가 나온다. */
export function normalizeRange(a: CellRef, b: CellRef): CellRange {
  return {
    r0: Math.min(a.r, b.r),
    r1: Math.max(a.r, b.r),
    c0: Math.min(a.c, b.c),
    c1: Math.max(a.c, b.c),
  };
}

export function rangeCells(range: CellRange): number {
  return (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
}

export function inRange(range: CellRange, r: number, c: number): boolean {
  return r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
}

/**
 * 엑셀/시트에서 복사한 텍스트를 행×열 격자로 되돌린다. 클립보드의 줄바꿈은
 * 운영체제마다 \r\n, \n, \r로 제각각이고, 마지막에 빈 줄이 하나 더 붙어 오는
 * 경우가 많다 — 그대로 두면 표 맨 끝에 빈 행을 덮어쓰게 된다.
 */
export function parseClipboardMatrix(text: string): string[][] {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (body === "") return [];
  return body.split("\n").map((line) => line.split("\t"));
}

/** 선택한 직사각형만 클립보드용 TSV로 만든다(머리글 없이 값만). */
export function rangeToTsv(
  rows: readonly TermRow[],
  columns: readonly GridColumn[],
  range: CellRange,
): string {
  const lines: string[] = [];
  for (let r = range.r0; r <= range.r1; r += 1) {
    const row = rows[r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = range.c0; c <= range.c1; c += 1) {
      const column = columns[c];
      if (!column) continue;
      cells.push(cellText(row, column.key).replace(/[\t\r\n]+/g, " "));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

// --- 여러 셀을 한 번에 바꾸는 계획 -----------------------------------------

export interface RowPatch {
  rowId: string;
  patch: CellPatch;
}

/**
 * 붙여넣기/채우기/비우기의 결과. 요청을 보내기 전에 "무엇이 바뀌고 무엇이
 * 안 바뀌는지"를 먼저 확정한다 — 한 줄씩 보내면서 중간에 실패하면 표의 절반만
 * 바뀐 상태가 남고, 되돌릴 기준도 사라진다.
 *
 * 한 행의 여러 열을 고쳐도 updates에는 그 행이 한 번만 들어간다. 행마다 PATCH가
 * 한 번이어야 리비전이 한 칸만 올라가고, 같이 쓰는 사람의 화면에도 "한 번 고침"
 * 으로 보인다.
 */
export interface WritePlan {
  updates: RowPatch[];
  /** 반영하지 못한 것에 대한 사람이 읽는 사유. */
  errors: string[];
  /** 실제로 값이 바뀌는 셀 수. 0이면 요청을 보내지 않는다. */
  cells: number;
}

interface PlanEntry {
  row: TermRow;
  column: GridColumn;
  raw: string;
}

function buildPlan(entries: readonly PlanEntry[]): WritePlan {
  const byRow = new Map<string, { row: TermRow; patch: CellPatch }>();
  const errors: string[] = [];
  let readonlySkipped = 0;

  for (const { row, column, raw } of entries) {
    if (column.kind === "readonly") {
      readonlySkipped += 1;
      continue;
    }
    // 값이 그대로면 저장하지 않는다 — 안 그러면 표를 훑고 지나가기만 해도
    // 리비전 기록이 의미 없는 줄로 채워진다.
    if (cellText(row, column.key) === raw.trim()) continue;

    const parsed = patchForCell(column.key, raw);
    if ("error" in parsed) {
      errors.push(`${rowLabel(row)} · ${column.label}: ${parsed.error}`);
      continue;
    }
    const prev = byRow.get(row.id);
    byRow.set(row.id, { row, patch: { ...(prev?.patch ?? {}), ...parsed.patch } });
  }

  const updates: RowPatch[] = [];
  let cells = 0;
  for (const { row, patch } of byRow.values()) {
    if (wouldClearBothNames(row, patch)) {
      errors.push(`${rowLabel(row)}: 영문·국문 표준명을 둘 다 비울 수는 없습니다.`);
      continue;
    }
    updates.push({ rowId: row.id, patch });
    cells += Object.keys(patch).length;
  }

  if (readonlySkipped > 0) errors.push(`읽기 전용 열 ${readonlySkipped}칸은 건너뛰었습니다.`);
  return { updates, errors, cells };
}

/** 표 끝을 넘어간 붙여넣기 줄 하나 = 새로 만들 용어 하나. */
export interface PastedRow {
  /** 클립보드 기준 줄 번호(1부터). 실패를 알릴 때 어느 줄인지 짚어야 한다. */
  line: number;
  /** POST /api/v1/terms 본문에 그대로 실리는 값. */
  values: CellPatch;
}

export interface PastePlan {
  /** 표에 이미 있는 행을 덮어쓰는 부분. */
  plan: WritePlan;
  /** 표 끝을 넘어간 부분. 잘라 버리는 대신 새 행으로 만든다. */
  creates: PastedRow[];
}

/**
 * 클립보드 한 줄을 새 용어의 생성 페이로드로 바꾼다.
 *
 * 빈 칸은 patch에 넣지 않는다 — 기존 행을 고칠 때의 빈 칸은 "지운다"(null)지만
 * 새 행에는 지울 값이 없고, null을 실어 보내면 서버 기본값(termType/status)까지
 * 덮어쓴다.
 *
 * 슬러그·최근 수정 같은 읽기 전용 열은 조용히 버린다. 이 표에서 복사한 줄을
 * 그대로 표 끝에 붙여넣는 것이 가장 흔한 사용법인데(엑셀에서 하듯 줄 복제),
 * 그때마다 "읽기 전용 열은 건너뛰었다"고 말하면 정상 동작이 경고가 된다.
 */
function draftFromLine(
  columns: readonly GridColumn[],
  anchorCol: number,
  line: readonly string[],
  lineNumber: number,
): { row: PastedRow } | { error: string | null } {
  const values: CellPatch = {};
  let filled = 0;

  for (let j = 0; j < line.length; j += 1) {
    const column = columns[anchorCol + j];
    const raw = line[j];
    if (!column || raw === undefined || column.kind === "readonly") continue;
    if (raw.trim() === "") continue;

    const parsed = patchForCell(column.key, raw);
    // 종류·상태가 잘못된 줄은 만들지 않는다. 그 값만 기본값으로 밀어 넣으면
    // 사용자가 적은 것과 다른 행이 조용히 생긴다.
    if ("error" in parsed) return { error: `${lineNumber}번째 줄 · ${column.label}: ${parsed.error}` };
    Object.assign(values, parsed.patch);
    filled += 1;
  }

  // 엑셀 선택 영역에는 빈 줄이 딸려 오는 일이 흔하다 — 오류가 아니라 없는 줄이다.
  if (filled === 0) return { error: null };
  if (!values.nameEn && !values.nameKo) {
    return { error: `${lineNumber}번째 줄: 영문·국문 표준명이 없어 새 행을 만들지 않았습니다.` };
  }
  return { row: { line: lineNumber, values } };
}

/**
 * 클립보드 격자를 anchor 셀을 왼쪽 위 모서리로 삼아 붙여넣는다.
 *
 * R134: 표 끝을 넘어간 줄은 버리지 않고 새 행으로 만든다. 엑셀에서 50줄을
 * 복사해 오는 것이 이 표의 실제 사용법인데, 예전처럼 "남은 줄이 모자라
 * 버렸다"고만 알리면 사용자는 먼저 빈 줄 50개를 만들어야 했다 — 그런 창구는
 * 어디에도 없다. 빈 표에 붙여넣는 경우(rows가 0줄)도 같은 경로다.
 */
export function planPaste(
  rows: readonly TermRow[],
  columns: readonly GridColumn[],
  anchor: CellRef,
  matrix: readonly string[][],
): PastePlan {
  const entries: PlanEntry[] = [];
  const creates: PastedRow[] = [];
  const createErrors: string[] = [];

  for (let i = 0; i < matrix.length; i += 1) {
    const line = matrix[i];
    if (!line) continue;

    const row = rows[anchor.r + i];
    if (!row) {
      const draft = draftFromLine(columns, anchor.c, line, i + 1);
      if ("row" in draft) creates.push(draft.row);
      else if (draft.error) createErrors.push(draft.error);
      continue;
    }

    for (let j = 0; j < line.length; j += 1) {
      const column = columns[anchor.c + j];
      const raw = line[j];
      if (!column || raw === undefined) continue;
      entries.push({ row, column, raw });
    }
  }

  const plan = buildPlan(entries);
  plan.errors.push(...createErrors);
  return { plan, creates };
}

/** 선택 영역의 첫 줄 값을 아래로 복사한다(엑셀의 Ctrl+D). */
export function planFill(
  rows: readonly TermRow[],
  columns: readonly GridColumn[],
  range: CellRange,
): WritePlan {
  const source = rows[range.r0];
  if (!source) return { updates: [], errors: [], cells: 0 };

  const entries: PlanEntry[] = [];
  for (let r = range.r0 + 1; r <= range.r1; r += 1) {
    const row = rows[r];
    if (!row) continue;
    for (let c = range.c0; c <= range.c1; c += 1) {
      const column = columns[c];
      if (!column) continue;
      entries.push({ row, column, raw: cellText(source, column.key) });
    }
  }
  return buildPlan(entries);
}

/** 선택 영역을 비운다. 종류·상태는 빈 값이 존재하지 않으므로 손대지 않는다. */
export function planClear(
  rows: readonly TermRow[],
  columns: readonly GridColumn[],
  range: CellRange,
): WritePlan {
  const entries: PlanEntry[] = [];
  let enumSkipped = 0;

  for (let r = range.r0; r <= range.r1; r += 1) {
    const row = rows[r];
    if (!row) continue;
    for (let c = range.c0; c <= range.c1; c += 1) {
      const column = columns[c];
      if (!column) continue;
      if (column.kind === "enum") {
        enumSkipped += 1;
        continue;
      }
      entries.push({ row, column, raw: "" });
    }
  }

  const plan = buildPlan(entries);
  if (enumSkipped > 0) plan.errors.push("종류·상태는 비울 수 없어 그대로 두었습니다.");
  return plan;
}

/** 한 셀 편집도 같은 경로를 타게 한다 — 되돌리기와 저장 로직이 하나로 유지된다. */
export function planCell(row: TermRow, column: GridColumn, raw: string): WritePlan {
  return buildPlan([{ row, column, raw }]);
}

/**
 * 되돌리기용 역패치. patch가 건드리는 열만, 지금 값으로 되돌린다.
 * domain은 배열이라 반드시 복사한다 — 현재 행의 배열을 그대로 참조해 두면
 * 낙관적 갱신이 그 배열을 바꾸는 순간 "되돌릴 값"도 같이 바뀌어 버린다.
 */
export function inversePatch(row: TermRow, patch: CellPatch): CellPatch {
  const out: CellPatch = {};
  for (const key of Object.keys(patch) as (keyof CellPatch)[]) {
    if (key === "domain") out.domain = [...row.domain];
    else Object.assign(out, { [key]: row[key] });
  }
  return out;
}
