export const TERM_QUALITY_LIMITS = { min: 0, max: 10_000 } as const;

export const TERM_QUALITY_PROFILES = ["auto", "mapping", "context", "guidance"] as const;
export type TermQualityProfile = (typeof TERM_QUALITY_PROFILES)[number];
export type ResolvedTermQualityProfile = Exclude<TermQualityProfile, "auto">;

export const TERM_QUALITY_PROFILE_LABEL: Record<TermQualityProfile, string> = {
  auto: "자동",
  mapping: "표기 매핑",
  context: "맥락 설명",
  guidance: "사용 지침",
};

export const TERM_QUALITY_PROFILE_DESCRIPTION: Record<ResolvedTermQualityProfile, string> = {
  mapping: "Full name 또는 한줄 정의로 표기의 뜻을 연결합니다.",
  context: "한줄 정의와 도메인·업무 분류로 사내 맥락을 구분합니다.",
  guidance: "한줄 정의와 분류 맥락에 실제 사용법·주의사항을 본문으로 더합니다.",
};

export interface TermQualitySettings {
  definitionMinChars: number;
  bodyMinChars: number;
}

/** 0은 항목을 생략한다는 뜻이 아니라, 내용 존재 여부만 검사한다. */
export const DEFAULT_TERM_QUALITY: TermQualitySettings = {
  definitionMinChars: 1,
  bodyMinChars: 0,
};

export function contentLength(value?: string | null): number {
  return [...(value?.trim() ?? "")].length;
}
