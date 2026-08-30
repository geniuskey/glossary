"use client";

/**
 * 초기 HTML을 파싱할 때만 실행해야 하는 인라인 스크립트입니다.
 *
 * React가 개발 모드에서 레이아웃을 다시 렌더링할 때는 script 태그를 실행할 수
 * 없으므로 text/plain으로 바꿉니다. suppressHydrationWarning은 서버와 클라이언트의
 * 의도적인 type 차이를 허용합니다.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
