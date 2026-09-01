import type { TermTypeLiteral } from "./enums";

export interface TermFieldLabels {
  nameEn: string;
  nameKo: string;
  fullNameEn: string;
  fullNameKo: string;
  primaryHint: string;
  showFullNames: boolean;
}

export const TERM_FIELD_LABELS: Record<TermTypeLiteral, TermFieldLabels> = {
  concept: {
    nameEn: "대표 영문 용어",
    nameKo: "대표 국문 용어",
    fullNameEn: "영문 확장명",
    fullNameKo: "국문 확장명",
    primaryHint: "목록과 페이지 제목에 먼저 표시할 대표 용어를 하나 이상 입력합니다.",
    showFullNames: false,
  },
  proper_name: {
    nameEn: "대표 영문 고유명칭",
    nameKo: "대표 국문 고유명칭",
    fullNameEn: "영문 전체 명칭",
    fullNameKo: "국문 전체 명칭",
    primaryHint: "제품·고객·프로젝트·조직처럼 고유하게 부르는 이름을 입력합니다.",
    showFullNames: false,
  },
  identifier: {
    nameEn: "대표 식별자",
    nameKo: "대표 국문 명칭",
    fullNameEn: "영문 대상 명칭",
    fullNameKo: "국문 대상 명칭",
    primaryHint: "제품 ID나 코드처럼 대상을 구분하는 대표 식별자를 입력합니다.",
    showFullNames: false,
  },
  unit: {
    nameEn: "대표 단위 기호",
    nameKo: "대표 국문 단위명",
    fullNameEn: "영문 단위명",
    fullNameKo: "국문 단위명",
    primaryHint: "단위 기호를 대표 표기로 두고, 단위명이나 다른 기호는 아래에서 추가할 수 있습니다.",
    showFullNames: false,
  },
};
