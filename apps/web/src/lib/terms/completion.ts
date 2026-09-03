import type { TermTypeLiteral } from "./enums";
import {
  contentLength,
  DEFAULT_TERM_QUALITY,
  type ResolvedTermQualityProfile,
  type TermQualityProfile,
  type TermQualitySettings,
} from "@/lib/workspace/term-quality-values";

export type MissingTermField = "meaning" | "definition" | "body" | "context";

export const MISSING_TERM_FIELD_LABEL: Record<MissingTermField, string> = {
  meaning: "Full name 또는 정의",
  definition: "한 줄 정의",
  body: "본문",
  context: "도메인 또는 업무 분류",
};

export interface CompletionSource {
  termType: TermTypeLiteral;
  qualityProfile?: TermQualityProfile | null;
  nameEn?: string | null;
  nameKo?: string | null;
  fullNameEn?: string | null;
  fullNameKo?: string | null;
  definitionMd?: string | null;
  bodyMd?: string | null;
  domain: string[];
  categories?: string[];
  status?: "draft" | "active" | "deprecated" | "forbidden";
}

export interface TermCompletion {
  complete: boolean;
  completed: number;
  total: number;
  percent: number;
  missing: MissingTermField[];
  configuredProfile: TermQualityProfile;
  resolvedProfile: ResolvedTermQualityProfile;
  minimums: Pick<TermQualitySettings, "definitionMinChars" | "bodyMinChars">;
}

function hasText(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function looksLikeAbbreviation(value?: string | null): boolean {
  const text = value?.trim() ?? "";
  return /^[A-Z0-9][A-Z0-9+./-]{1,11}$/.test(text);
}

export function resolveTermQualityProfile(term: CompletionSource): ResolvedTermQualityProfile {
  const configured = term.qualityProfile ?? "auto";
  if (configured !== "auto") return configured;
  if (term.status === "deprecated" || term.status === "forbidden") return "guidance";

  const hasFullName = hasText(term.fullNameEn) || hasText(term.fullNameKo);
  const abbreviation = looksLikeAbbreviation(term.nameEn) || looksLikeAbbreviation(term.nameKo);
  if (hasFullName && (abbreviation || term.termType === "identifier" || term.termType === "unit")) {
    return "mapping";
  }
  return "context";
}

/**
 * 용어의 양을 평가하지 않고, 팀원이 의미를 이해하는 데 필요한 최소 항목만 본다.
 * Type과 표기 종류는 분리되어 있으므로 Type에 따른 숨은 필수값을 만들지 않는다.
 * profile마다 AI가 뜻을 구분하는 데 필요한 구조만 요구한다.
 */
export function termCompletion(term: CompletionSource, settings: TermQualitySettings = DEFAULT_TERM_QUALITY): TermCompletion {
  const configuredProfile = term.qualityProfile ?? "auto";
  const resolvedProfile = resolveTermQualityProfile(term);
  const hasDefinition = contentLength(term.definitionMd) >= Math.max(1, settings.definitionMinChars);
  const hasBody = contentLength(term.bodyMd) >= Math.max(1, settings.bodyMinChars);
  const hasFullName = hasText(term.fullNameEn) || hasText(term.fullNameKo);
  const hasContext = [...term.domain, ...(term.categories ?? [])].some((value) => Boolean(value.trim()));
  const required: MissingTermField[] = resolvedProfile === "mapping"
    ? ["meaning"]
    : resolvedProfile === "context"
      ? ["definition", "context"]
      : ["definition", "context", "body"];

  const missing = required.filter((field) => {
    if (field === "meaning") return !(hasFullName || hasDefinition);
    if (field === "definition") return !hasDefinition;
    if (field === "body") return !hasBody;
    if (field === "context") return !hasContext;
    return false;
  });
  const completed = required.length - missing.length;

  return {
    complete: missing.length === 0,
    completed,
    total: required.length,
    percent: Math.round((completed / required.length) * 100),
    missing,
    configuredProfile,
    resolvedProfile,
    minimums: settings,
  };
}
