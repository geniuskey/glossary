import { defineConfig } from "vitepress";

// 기본 slug 규칙을 유지하되 한글을 NFC로 합쳐 본문의 수동 앵커 링크와 맞춘다.
const slugify = (text: string) => text
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\u0000-\u001f]/g, "")
  .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
  .replace(/-{2,}/g, "-")
  .replace(/^-+|-+$/g, "")
  .replace(/^(\d)/, "_$1")
  .toLowerCase()
  .normalize("NFC");

// GitHub Pages는 https://geniuskey.github.io/glossary/ 아래에 올라간다.
// base를 빼면 모든 자산 경로가 루트 기준이 되어 404가 난다.
export default defineConfig({
  base: "/glossary/",
  lang: "ko-KR",
  title: "Glossary",
  description: "한국어와 영어를 함께 쓰는 조직을 위한 셀프호스팅 용어집 관리 플랫폼",
  lastUpdated: true,
  markdown: { anchor: { slugify }, toc: { slugify } },

  // 설계·검토·인계 기록은 저장소에서 관리하고 공개 사이트와 검색에서는 제외한다.
  srcExclude: ["README.md", "superpowers/**", "reviews/**", "CODEX_HANDOFF.md", "product-review-*.md"],

  // 본문에 적힌 개발 서버 주소까지 데드링크로 잡히면 빌드가 막힌다.
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  head: [["link", { rel: "icon", href: "/glossary/favicon.svg" }]],

  themeConfig: {
    nav: [
      { text: "가이드", link: "/guide/", activeMatch: "/guide/" },
      { text: "API", link: "/api/", activeMatch: "/api/" },
      { text: "운영", link: "/operations" },
      { text: "도움말", link: "/help" },
      { text: "지원", link: "/support" },
      { text: "Docker Hub", link: "https://hub.docker.com/r/euiyun/glossary" },
    ],

    sidebar: [
      {
        text: "사용 가이드",
        items: [
          { text: "소개", link: "/guide/" },
          { text: "제품 도움말", link: "/help" },
          { text: "데이터 모델", link: "/guide/data-model" },
          { text: "협업과 관계도", link: "/guide/collaboration" },
          { text: "함께 정리", link: "/guide/contribute" },
          { text: "AI 활용과 챗봇", link: "/guide/ai" },
          { text: "에이전트 고도화 전략", link: "/guide/agent-strategy" },
        ],
      },
      {
        text: "개발 가이드",
        items: [
          { text: "개발 환경 시작하기", link: "/guide/getting-started" },
          { text: "아키텍처", link: "/guide/architecture" },
          { text: "테스트", link: "/guide/testing" },
          { text: "로드맵", link: "/guide/roadmap" },
        ],
      },
      {
        text: "API",
        items: [
          { text: "개요", link: "/api/" },
          { text: "인증", link: "/api/auth" },
          { text: "용어", link: "/api/terms" },
          { text: "의미 관계", link: "/api/relations" },
          { text: "임포트", link: "/api/import" },
          { text: "첨부 이미지", link: "/api/attachments" },
          { text: "AI 연결과 챗봇", link: "/api/ai" },
          { text: "RAG 검색", link: "/api/rag" },
          { text: "문서 검증", link: "/api/validation" },
        ],
      },
      {
        text: "운영",
        items: [
          { text: "설치·백업·복구", link: "/operations" },
          { text: "SSO 연결", link: "/guide/sso" },
        ],
      },
      {
        text: "프로젝트",
        items: [
          { text: "지원", link: "/support" },
          { text: "기여 안내", link: "https://github.com/geniuskey/glossary/blob/main/CONTRIBUTING.md" },
          { text: "보안 정책", link: "https://github.com/geniuskey/glossary/blob/main/SECURITY.md" },
          { text: "라이선스", link: "https://github.com/geniuskey/glossary/blob/main/LICENSE" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/geniuskey/glossary" }],

    search: { provider: "local" },

    editLink: {
      pattern: "https://github.com/geniuskey/glossary/edit/main/docs/:path",
      text: "GitHub에서 이 페이지 수정하기",
    },

    outline: { level: [2, 3], label: "목차" },
    docFooter: { prev: "이전", next: "다음" },
    lastUpdatedText: "마지막 수정",
    darkModeSwitchLabel: "테마",
    returnToTopLabel: "맨 위로",
    sidebarMenuLabel: "메뉴",

    footer: {
      message: "사내망 온프레미스 배포를 전제로 만든 Apache-2.0 프로젝트입니다.",
      copyright: "© 2026 Euiyun Kim",
    },
  },
});
