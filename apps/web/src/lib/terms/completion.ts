import {
  contentLength,
  DEFAULT_TERM_QUALITY,
  type ResolvedTermQualityProfile,
  type TermQualityProfile,
  type TermQualitySettings,
} from "@/lib/workspace/term-quality-values";

export type MissingTermField = "meaning" | "definition" | "body" | "context";

export const MISSING_TERM_FIELD_LABEL: Record<MissingTermField, string> = {
  meaning: "Full name 또는 한줄 정의",
  definition: "한줄 정의",
  body: "본문",
  context: "도메인 또는 업무 분류",
};

export interface CompletionSource {
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
  if (term.status === "deprecated" || term.status === "forbidden") return "guidance";

  const hasFullName = hasText(term.fullNameEn) || hasText(term.fullNameKo);
  const abbreviation = looksLikeAbbreviation(term.nameEn) || looksLikeAbbreviation(term.nameKo);
  if (hasFullName && abbreviation) {
    return "mapping";
  }
  return "context";
}

/**
 * 용어의 양을 평가하지 않고, 팀원이 의미를 이해하는 데 필요한 최소 항목만 본다.
 * profile마다 AI가 뜻을 구분하는 데 필요한 구조만 요구한다.
 */
export function termCompletion(term: CompletionSource, settings: TermQualitySettings = DEFAULT_TERM_QUALITY): TermCompletion {
  // qualityProfile은 기존 API·리비전 호환성을 위해 보존하지만 완성도 판정은
  // 플랫폼이 용어의 상태와 내용만 보고 결정한다.
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
