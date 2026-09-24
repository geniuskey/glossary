import type { ReactNode } from "react";
import { connection } from "next/server";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "katex/dist/katex.min.css";
import { InlineScript } from "@/components/inline-script";
import { getWorkspaceMenuSettings } from "@/lib/workspace/menu-settings";
import { DEFAULT_WORKSPACE_MENU_SETTINGS } from "@/lib/workspace/menu-settings-values";
import "./globals.css";

export const metadata = {
  title: { default: "Glossary 용어집", template: "%s · Glossary" },
  description: "우리가 쓰는 말을 우리의 기준으로. 누구나 찾고, 제안하고, 함께 다듬는 팀 용어집.",
};

// 첫 페인트 전에 저장된 테마를 <html>에 건다. 여기서 하지 않고 컴포넌트의
// effect로 미루면 밝은 화면이 한 프레임 번쩍인다(브라우저는 HTML을 파싱하는
// 도중 이 스크립트를 동기 실행한다). 값이 없으면 아무것도 하지 않고 시스템
// 설정(prefers-color-scheme)을 그대로 따른다.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("glossary.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

// 대표 색은 body로 포털되는 팝오버까지 닿아야 해서 셸이 아니라 <html>에 건다.
// connection()이 없으면 빌드가 정적 화면(소개·도움말)을 사전 렌더링하면서 DB에
// 붙는다. DB를 못 읽는 순간에도 화면은 떠야 하므로 기본 색으로 물러난다.
async function loadBrandPreset() {
  await connection();
  try {
    return (await getWorkspaceMenuSettings()).brandPreset;
  } catch {
    return DEFAULT_WORKSPACE_MENU_SETTINGS.brandPreset;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const brand = await loadBrandPreset();
  return (
    <html lang="ko" data-brand={brand === DEFAULT_WORKSPACE_MENU_SETTINGS.brandPreset ? undefined : brand} suppressHydrationWarning>
      <head>
        <InlineScript html={THEME_SCRIPT} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
