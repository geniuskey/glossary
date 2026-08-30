import { defineConfig } from "vitepress";

// GitHub Pages는 https://geniuskey.github.io/grossary/ 아래에 올라간다.
// base를 빼면 모든 자산 경로가 루트 기준이 되어 404가 난다.
export default defineConfig({
  base: "/grossary/",
  lang: "ko-KR",
  title: "Grossary",
  description: "한국어와 영어를 함께 쓰는 조직을 위한 셀프호스팅 용어집 관리 플랫폼",
  lastUpdated: true,

  // docs/superpowers/ 는 설계 스펙과 구현 계획 원본이다. 사이트에 싣지 않고
  // 저장소에만 둔다 — 링크는 guide/roadmap.md에서 GitHub로 건다.
  srcExclude: ["superpowers/**"],

  // 본문에 적힌 개발 서버 주소까지 데드링크로 잡히면 빌드가 막힌다.
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  head: [["link", { rel: "icon", href: "/grossary/favicon.svg" }]],

  themeConfig: {
    nav: [
      { text: "가이드", link: "/guide/", activeMatch: "/guide/" },
      { text: "API", link: "/api/", activeMatch: "/api/" },
      { text: "운영", link: "/operations" },
    ],

    sidebar: [
      {
        text: "가이드",
        items: [
          { text: "소개", link: "/guide/" },
          { text: "시작하기", link: "/guide/getting-started" },
          { text: "아키텍처", link: "/guide/architecture" },
          { text: "데이터 모델", link: "/guide/data-model" },
          { text: "협업과 관계도", link: "/guide/collaboration" },
          { text: "SSO 연결", link: "/guide/sso" },
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
          { text: "임포트", link: "/api/import" },
        ],
      },
      {
        text: "운영",
        items: [{ text: "운영 안내서", link: "/operations" }],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/geniuskey/grossary" }],

    search: { provider: "local" },

    editLink: {
      pattern: "https://github.com/geniuskey/grossary/edit/main/docs/:path",
      text: "GitHub에서 이 페이지 수정하기",
    },

    outline: { level: [2, 3], label: "목차" },
    docFooter: { prev: "이전", next: "다음" },
    lastUpdatedText: "마지막 수정",
    darkModeSwitchLabel: "테마",
    returnToTopLabel: "맨 위로",
    sidebarMenuLabel: "메뉴",

    footer: {
      message: "사내망 온프레미스 배포를 전제로 만든 프로젝트입니다.",
      copyright: "geniuskey/grossary",
    },
  },
});
