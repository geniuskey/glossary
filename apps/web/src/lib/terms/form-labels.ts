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
  term: {
    nameEn: "대표 영문 용어",
    nameKo: "대표 국문 용어",
    fullNameEn: "영문 확장명",
    fullNameKo: "국문 확장명",
    primaryHint: "목록과 페이지 제목에 먼저 표시할 대표 용어를 하나 이상 입력합니다.",
    showFullNames: false,
  },
  abbreviation: {
    nameEn: "대표 약어 (영문·공통)",
    nameKo: "대표 국문 표기",
    fullNameEn: "대표 영문 풀네임",
    fullNameKo: "대표 국문 풀네임",
    primaryHint: "대표 약어나 국문 표기 중 하나를 입력하고, 다른 약어·풀네임은 아래에서 더 추가할 수 있습니다.",
    showFullNames: true,
  },
  project: {
    nameEn: "대표 영문 프로젝트명",
    nameKo: "대표 국문 프로젝트명",
    fullNameEn: "영문 전체 명칭",
    fullNameKo: "국문 전체 명칭",
    primaryHint: "목록과 페이지 제목에 표시할 프로젝트명을 입력합니다.",
    showFullNames: false,
  },
  product_id: {
    nameEn: "대표 제품 ID",
    nameKo: "대표 국문 제품명",
    fullNameEn: "영문 제품명",
    fullNameKo: "국문 제품명",
    primaryHint: "제품 ID를 대표 표기로 두고, 제품명이나 구형 ID는 아래에서 추가할 수 있습니다.",
    showFullNames: false,
  },
  code: {
    nameEn: "대표 코드",
    nameKo: "대표 국문 코드명",
    fullNameEn: "영문 코드 설명",
    fullNameKo: "국문 코드 설명",
    primaryHint: "문서에서 기준으로 사용할 대표 코드를 입력합니다.",
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
