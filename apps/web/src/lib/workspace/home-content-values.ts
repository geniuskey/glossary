export const HOME_CONTENT_LIMITS = {
  eyebrow: 48,
  title: 120,
  description: 280,
} as const;

export interface HomeContent {
  eyebrow: string;
  title: string;
  description: string;
}

/** 설정 행이 아직 없는 기존 설치에서도 지금까지의 홈 문구를 그대로 보여준다. */
export const DEFAULT_HOME_CONTENT: HomeContent = {
  eyebrow: "Glossary",
  title: "우리가 쓰는 말,\n우리의 기준으로.",
  description: "약어, 별칭, 헷갈리는 표현을 검색해 보세요.\n팀이 함께 정리한 하나의 의미로 연결해 드립니다.",
};
