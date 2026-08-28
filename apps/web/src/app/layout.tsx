import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: { default: "Grossary 용어집", template: "%s · Grossary" },
  description: "센서 제품 개발용 용어집 — 개념 하나에 표기 여럿, 함께 관리하는 사전.",
};

// 첫 페인트 전에 저장된 테마를 <html>에 건다. 여기서 하지 않고 컴포넌트의
// effect로 미루면 밝은 화면이 한 프레임 번쩍인다(브라우저는 HTML을 파싱하는
// 도중 이 스크립트를 동기 실행한다). 값이 없으면 아무것도 하지 않고 시스템
// 설정(prefers-color-scheme)을 그대로 따른다.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("grossary.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
