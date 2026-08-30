import path from "node:path";
import type { NextConfig } from "next";

// .env는 저장소 루트에 하나만 둔다(운영 안내서·getting-started의 전제).
// 하지만 next dev는 apps/web에서 돌고 Next.js는 자기 디렉터리의 .env만
// 자동 로드하므로, 루트 .env를 여기서 직접 읽어 process.env에 채운다.
// 운영(compose)에서는 이 파일이 없고 값이 컨테이너 환경으로 주어지므로,
// 없거나 이미 채워진 경우는 조용히 넘어간다.
const rootEnv = path.join(import.meta.dirname, "../../.env");
try {
  process.loadEnvFile(rootEnv);
} catch {
  // 파일이 없으면(운영·CI) 컨테이너/셸 환경변수를 그대로 쓴다.
}

/**
 * R135: 화면 주소를 나무위키식으로 줄이면서(`/w/<slug>`, `/edit/<slug>`) 옛
 * `/terms/*` 주소를 전부 살려 둔다. 용어 링크는 이슈·위키·메신저에 이미 붙어
 * 나간 뒤라, 끊기면 "그 링크 죽었네"로만 드러나고 아무 로그도 남지 않는다.
 *
 * 라우트 파일(`app/terms/.../page.tsx`에서 redirect() 호출) 대신 여기 두는
 * 이유: 그러려면 `app/terms/` 디렉터리가 계속 존재해야 하고, 그러면 새 주소로
 * 옮긴 의미가 반쯤 사라진다. 리다이렉트는 파일시스템보다 먼저 검사되고 쿼리
 * 문자열은 그대로 넘어가므로 `/terms?q=soc`의 필터도 살아 있다.
 *
 * 순서가 의미를 바꾼다 — `/terms/new`가 `/terms/:slug`보다 위에 있어야 한다.
 * 아래로 내려가면 "new"가 슬러그로 잡혀 `/w/new`로 가 버린다(`:slug`는 중첩
 * 경로를 먹지 않으므로 edit/history와 `:slug`의 순서는 무관하지만, 읽는 사람이
 * 순서에 기대게 두지 않으려고 좁은 것부터 적는다).
 */
export const legacyRedirects = [
  { source: "/terms", destination: "/sheet", permanent: true },
  { source: "/terms/new", destination: "/new", permanent: true },
  { source: "/terms/:slug/edit", destination: "/edit/:slug", permanent: true },
  { source: "/terms/:slug/history", destination: "/history/:slug", permanent: true },
  { source: "/terms/:slug", destination: "/w/:slug", permanent: true },
] as const;

/** 동적 화면과 API를 같은 출처에서 제공하므로 전 경로에 공통으로 적용한다. */
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
] as const;

const config: NextConfig = {
  output: "standalone",
  redirects: async () => [...legacyRedirects],
  headers: async () => [{ source: "/:path*", headers: [...securityHeaders] }],
  // 모노레포에서는 트레이싱 루트를 워크스페이스 최상단으로 올려야
  // standalone 번들에 packages/*가 포함된다.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@grossary/db", "@grossary/engine"],
};

export default config;
