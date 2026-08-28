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
  | "slug"
  | "updatedAt";

export type CellKind = "text" | "enum" | "list" | "readonly";

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
  { key: "fullNameEn", label: "영문 풀네임", kind: "text", width: 220, hiddenByDefault: true },
  { key: "fullNameKo", label: "국문 풀네임", kind: "text", width: 200, hiddenByDefault: true },
  { key: "termType", label: "종류", kind: "enum", width: 110, options: TYPE_OPTIONS, sortKey: "termType" },
  { key: "status", label: "상태", kind: "enum", width: 100, options: STATUS_OPTIONS, sortKey: "status" },
  { key: "domain", label: "도메인", kind: "list", width: 160 },
  { key: "definitionMd", label: "정의", kind: "text", width: 300 },
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
    "nameEn" | "nameKo" | "fullNameEn" | "fullNameKo" | "termType" | "status" | "domain" | "definitionMd"
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
