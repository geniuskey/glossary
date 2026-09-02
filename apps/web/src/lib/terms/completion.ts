import type { TermTypeLiteral } from "./enums";
import {
  contentLength,
  DEFAULT_TERM_QUALITY,
  type TermQualitySettings,
} from "@/lib/workspace/term-quality-values";

export type MissingTermField = "definition" | "body" | "domain";

export const MISSING_TERM_FIELD_LABEL: Record<MissingTermField, string> = {
  definition: "한 줄 정의",
  body: "본문",
  domain: "제품·업무 분야",
};

export interface CompletionSource {
  termType: TermTypeLiteral;
  fullNameEn?: string | null;
  fullNameKo?: string | null;
  definitionMd?: string | null;
  bodyMd?: string | null;
  domain: string[];
}

export interface TermCompletion {
  complete: boolean;
  completed: number;
  total: number;
  percent: number;
  missing: MissingTermField[];
  minimums: Pick<TermQualitySettings, "definitionMinChars" | "bodyMinChars">;
}

/**
 * 용어의 양을 평가하지 않고, 팀원이 의미를 이해하는 데 필요한 최소 항목만 본다.
 * Type과 표기 종류는 분리되어 있으므로 Type에 따른 숨은 필수값을 만들지 않는다.
 * 본문·별칭·풀네임은 있으면 좋은 선택 정보로 남긴다.
 */
export function termCompletion(term: CompletionSource, settings: TermQualitySettings = DEFAULT_TERM_QUALITY): TermCompletion {
  const required: MissingTermField[] = [
    ...(settings.definitionMinChars > 0 ? ["definition" as const] : []),
    ...(settings.bodyMinChars > 0 ? ["body" as const] : []),
    "domain",
  ];
  const hasDefinition = contentLength(term.definitionMd) >= settings.definitionMinChars;
  const hasBody = contentLength(term.bodyMd) >= settings.bodyMinChars;
  const hasDomain = term.domain.some((value) => Boolean(value.trim()));

  const missing = required.filter((field) => {
    if (field === "definition") return !hasDefinition;
    if (field === "body") return !hasBody;
    return !hasDomain;
  });
  const completed = required.length - missing.length;

  return {
    complete: missing.length === 0,
    completed,
    total: required.length,
    percent: Math.round((completed / required.length) * 100),
    missing,
    minimums: settings,
  };
}
