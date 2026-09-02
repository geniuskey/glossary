export const TERM_QUALITY_LIMITS = { min: 0, max: 10_000 } as const;

export interface TermQualitySettings {
  definitionMinChars: number;
  bodyMinChars: number;
}

/** 기존 설치의 완성도 판정(정의는 필요, 본문은 선택)을 그대로 보존한다. */
export const DEFAULT_TERM_QUALITY: TermQualitySettings = {
  definitionMinChars: 1,
  bodyMinChars: 0,
};

export function contentLength(value?: string | null): number {
  return [...(value?.trim() ?? "")].length;
}
