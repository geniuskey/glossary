import { HEADER_TO_FIELD, normalizeHeader } from "./format";

export const REVIEW_OPTIONAL_COLUMNS = [
  { key: "domain", label: "도메인", example: "ISP, HW" },
  { key: "definitionMd", label: "한줄 정의", example: "장면 밝기에 맞춰 노출을 조절하는 기능" },
  { key: "bodyMd", label: "본문", example: "상세 설명 (마크다운 사용 가능)" },
] as const;
export type ReviewOptionalColumn = (typeof REVIEW_OPTIONAL_COLUMNS)[number]["key"];
export function reviewColumns(selected: readonly ReviewOptionalColumn[]) {
  return [
    { key: "nameEn" as const, label: "영문", example: "AE; Auto Exposure" },
    { key: "nameKo" as const, label: "한글", example: "자동 노출; 자동노출" },
    ...REVIEW_OPTIONAL_COLUMNS.filter((column) => selected.includes(column.key)),
  ];
}

/** Shared by workbook import and sheet paste. No server dependencies. */
export interface SplitOptions { comma: boolean; semicolon: boolean; newline: boolean }
export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { comma: true, semicolon: true, newline: true };
export interface ReviewDecision {
  rowNumber: number;
  en: string[];
  ko: string[];
  skip: boolean;
  approval?: string;
}
export interface ReviewRow extends ReviewDecision {
  originalEn: string;
  originalKo: string;
  reasons: string[];
  errors: string[];
  fingerprint: string;
  domain?: string[];
  definitionMd?: string;
  bodyMd?: string;
}
export interface ReviewReport {
  rows: ReviewRow[];
  fileErrors: { message: string }[];
  errors: { rowNumber: number; message: string }[];
  ignoredHeaders: string[];
}

export function splitSurfaceCell(raw: string, options = DEFAULT_SPLIT_OPTIONS): { values: string[]; reasons: string[] } {
  const values: string[] = [];
  const reasons: string[] = [];
  const stack: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", "（": "）" };
  let quote = "";
  let token = "";
  const push = () => { const value = token.trim(); if (value && !values.includes(value)) values.push(value); token = ""; };
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (quote) {
      token += char;
      if (char === quote) {
        if (raw[i + 1] === quote) token += raw[++i];
        else quote = "";
      }
      continue;
    }
    if (char === '"' || char === "“") { quote = char === "“" ? "”" : '"'; token += char; continue; }
    if (pairs[char]) stack.push(pairs[char]!);
    else if ([")", "]", "}", "）"].includes(char)) {
      if (stack.pop() !== char) reasons.push("괄호 짝이 맞지 않습니다.");
    }
    const separator = (options.comma && char === ",") || (options.semicolon && char === ";")
      || (options.newline && (char === "\n" || char === "\r"));
    if (separator && stack.length === 0) {
      if (char === ",") reasons.push("쉼표가 이름의 일부인지 확인해 주세요.");
      push();
    } else token += char;
  }
  push();
  if (quote || stack.length) reasons.push("닫히지 않은 괄호 또는 따옴표가 있습니다.");
  return { values, reasons: [...new Set(reasons)] };
}

export function reviewFingerprint(row: Pick<ReviewRow, "rowNumber" | "en" | "ko" | "reasons" | "errors" | "domain" | "definitionMd" | "bodyMd">): string {
  return JSON.stringify([row.rowNumber, row.en, row.ko, row.reasons, row.errors, row.domain, row.definitionMd, row.bodyMd]);
}

export function needsReview(row: ReviewRow): boolean {
  return !row.skip && (row.errors.length > 0 || (row.reasons.length > 0 && row.approval !== row.fingerprint));
}

/** Recognize the simple import's required names plus supported optional columns. */
export function isSimpleGlossaryHeader(line: readonly string[]): boolean {
  const fields = line.map((v) => HEADER_TO_FIELD[normalizeHeader(v.trim())]);
  return fields.length >= 2 && fields.every((field) => field && ["nameEn", "nameKo", ...REVIEW_OPTIONAL_COLUMNS.map((c) => c.key)].includes(field))
    && fields.some((field) => field === "nameEn" || field === "nameKo");
}
