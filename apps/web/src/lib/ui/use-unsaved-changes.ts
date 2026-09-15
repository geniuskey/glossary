"use client";

import { useEffect } from "react";

/** 편집 내용이 있을 때 문서 닫기와 앱 내 링크 이동을 보호한다. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warning = "저장하지 않은 변경사항이 있습니다. 이 페이지를 나갈까요?";
    const currentUrl = window.location.href;
    const currentHistoryState = window.history.state;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeLinkNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname
        && destination.search === window.location.search && destination.hash) return;
      if (window.confirm(warning)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const warnBeforeHistoryNavigation = (event: PopStateEvent) => {
      if (window.confirm(warning)) return;
      // popstate 자체는 취소할 수 없으므로 캡처 단계에서 앱 라우터보다 먼저
      // 막고, 원래 URL과 history state를 복원한다. 뒤로가기·앞으로가기 모두
      // 같은 경고를 거친다.
      event.stopImmediatePropagation();
      window.history.pushState(currentHistoryState, "", currentUrl);
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeLinkNavigation, true);
    window.addEventListener("popstate", warnBeforeHistoryNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeLinkNavigation, true);
      window.removeEventListener("popstate", warnBeforeHistoryNavigation, true);
    };
  }, [dirty]);
}
