import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { cx } from "@/lib/ui/format";
import { AccountMenu } from "./account-menu";
import { CollapsibleSidebar } from "./collapsible-sidebar";
import { SearchBox } from "./search-box";

export type NavKey = "contribute" | "sheet" | "classifications" | "graph" | "chat" | "import" | "statistics" | "settings" | "admin";

export const APP_NAV_ITEMS: Array<{ key: NavKey; href: string; label: string; hint: string; icon: ReactNode; adminOnly?: true }> = [
  { key: "contribute", href: "/contribute", label: "함께 정리", hint: "미완성", icon: <IconContribute /> },
  { key: "sheet", href: "/sheet", label: "시트", hint: "표 편집", icon: <IconGrid /> },
  { key: "classifications", href: "/classifications", label: "분류 체계", hint: "도메인 · 업무", icon: <IconClassification /> },
  { key: "graph", href: "/graph", label: "관계도", hint: "맥락 탐색", icon: <IconGraph /> },
  { key: "chat", href: "/chat", label: "용어 챗봇", hint: "AI 질문", icon: <IconChat /> },
  { key: "import", href: "/import", label: "가져오기", hint: "엑셀", icon: <IconImport /> },
  { key: "statistics", href: "/statistics", label: "통계", hint: "운영 현황", icon: <IconStatistics />, adminOnly: true },
];

/**
 * 화면 뼈대. 현재 위치는 usePathname 대신 각 화면이 넘기는 `current`로 받는다 —
 * 그 훅 하나 때문에 셸 전체가 Client Component가 되면 헤더·네비게이션이 통째로
 * 클라이언트 번들에 실린다(LogoutButton/ThemeToggle만 클라이언트인 이유와 같다).
 *
 * `wide`는 용어 표(그리드) 화면처럼 가로를 끝까지 써야 하는 경우다. 본문 폭을
 * 화면마다 제각각 정하면 사이드바와의 간격이 화면마다 달라 보인다.
 */
export function AppShell({
  user,
  title,
  current,
  wide = false,
  roomy = false,
  dense = false,
  children,
}: {
  user: CurrentUser | null;
  title: string;
  current?: NavKey;
  wide?: boolean;
  /** 문서형 여백은 유지하되, 편집기처럼 가로 공간이 더 필요한 화면에 쓴다. */
  roomy?: boolean;
  /** 편집기처럼 한 화면에 많은 정보를 보여줘야 하는 작업 화면의 여백을 줄인다. */
  dense?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-50 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-on focus:not-sr-only"
      >
        본문으로 건너뛰기
      </a>
      {/* 좁은 화면: 상단 바. 넓은 화면: 왼쪽 고정 사이드바. 하나의 마크업으로
          둘 다 처리해서 네비게이션 항목이 두 곳에 중복되지 않게 한다. */}
      <CollapsibleSidebar
        brand={(
          <Link href="/" title="Glossary 홈" className="sidebar-brand flex items-center gap-2.5 lg:min-w-0 lg:flex-1 lg:px-2" aria-label="Glossary 홈">
            <BrandMark />
            <span className="sidebar-expanded-only hidden min-w-0 flex-col leading-none lg:flex">
              <span className="text-[15px] font-semibold tracking-tight text-ink">Glossary</span>
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">
                용어집
              </span>
            </span>
          </Link>
        )}
        navigation={(
          <nav id="primary-navigation" aria-label="주 메뉴" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex-none lg:flex-col lg:items-stretch lg:gap-0.5 lg:px-2">
            {APP_NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "admin").map((item) => {
              const active = item.key === current;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={`${item.label} · ${item.hint}`}
                  title={`${item.label} · ${item.hint}`}
                  className={cx(
                    "sidebar-nav-link group flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm transition",
                    "lg:h-auto lg:w-auto lg:justify-start lg:gap-2.5 lg:px-2.5 lg:py-2",
                    active
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  <span className={cx("shrink-0", active ? "text-brand" : "text-ink-3 group-hover:text-ink-2")}>
                    {item.icon}
                  </span>
                  <span className="sidebar-expanded-only hidden whitespace-nowrap lg:inline">{item.label}</span>
                  <span className="sidebar-expanded-only ml-auto hidden text-[10px] text-ink-3 lg:block">{item.hint}</span>
                </Link>
              );
            })}
          </nav>
        )}
      />

      <div className={cx(
        "min-w-0 flex-1",
        wide && "flex min-h-[calc(100svh-3.5rem)] flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden",
      )}>
        {/* 시트의 필터 바와 고정 표 머리글보다 높은 쌓임 맥락을 만든다. 자식인
            계정 팝오버의 z-index가 아무리 높아도 이 부모가 낮으면 표 아래로
            들어가므로, 앱 전역 상단 바 자체가 작업 영역보다 위에 있어야 한다. */}
        <header className="sticky top-14 z-[70] shrink-0 border-b border-line bg-panel/90 px-4 py-2 backdrop-blur lg:top-0 lg:px-6">
          {/* 우측 액션은 실제 콘텐츠 폭을 먼저 확보하고, 검색창은 남은 폭 안에서
              42rem까지 유동적으로 늘고 줄어든다. 타이틀 열에는 한글 약 4자 폭을
              남겨 좁은 데스크톱에서도 제목이 여러 줄로 뭉개지지 않게 한다. */}
          <div className="flex w-full items-center gap-2 lg:grid lg:grid-cols-[minmax(4rem,1fr)_minmax(0,42rem)_auto] lg:gap-4">
            <h1 className="sr-only min-w-0 truncate text-sm font-semibold tracking-tight text-ink lg:not-sr-only">
              {title}
            </h1>
            <div className="min-w-0 flex-1 lg:col-start-2">
              <SearchBox defaultValue="" compact />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 lg:col-start-3 lg:ml-0 lg:justify-self-end">
              <Link href="/new" className="btn-primary h-9 shrink-0 px-3" aria-label="새 용어 추가">
                <IconPlus />
                <span className="hidden sm:inline">용어 추가</span>
              </Link>
              {user && <AccountMenu user={user} current={current} placement="topbar" />}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cx(
            "min-w-0 flex-1",
            wide
              ? "flex min-h-0 flex-col"
              : dense
                ? "mx-auto w-full max-w-[90rem] px-4 py-3 lg:px-6"
                : cx("mx-auto w-full px-5 py-8 lg:px-8", roomy ? "max-w-6xl" : "max-w-4xl"),
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/** Glossary의 G와 새로 보탠 지식을 뜻하는 점을 결합한 마크.
 * 홈·인증 화면·앱 셸이 한 컴포넌트를 공유해 브랜드가 언제나 같게 보인다. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0 drop-shadow-sm">
      <rect width="32" height="32" rx="6.5" className="fill-brand" />
      <path d="M21.5 10.8a7.2 7.2 0 1 0 .25 9.8" fill="none" className="stroke-brand-on" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M16.7 17.2h6v5.3" fill="none" className="stroke-brand-on" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="27" cy="5" r="3.85" className="fill-panel" />
      <circle cx="27" cy="5" r="2.6" className="fill-accent" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6.25h12.5M6 6.25v7" />
    </svg>
  );
}

function IconImport() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 1.75v7.5m0 0L5.25 6.5M8 9.25 10.75 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.25 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8.5a1.5 1.5 0 0 0 1.5-1.5v-2" strokeLinecap="round" />
    </svg>
  );
}

function IconGraph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="11.5" cy="3.5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="m4.4 7.2 5.7-3M4.5 8.7l6 2.5M11.7 5.1l.2 5.3" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 3.75A1.75 1.75 0 0 1 3.75 2h8.5A1.75 1.75 0 0 1 14 3.75v5.5A1.75 1.75 0 0 1 12.25 11H7l-3.5 2.75V11.1A1.75 1.75 0 0 1 2 9.25v-5.5Z" strokeLinejoin="round" />
      <path d="M5 6.5h6M5 8.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

function IconClassification() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.75" y="2" width="4" height="4" rx="1" />
      <rect x="10.25" y="2" width="4" height="4" rx="1" />
      <rect x="6" y="10" width="4" height="4" rx="1" />
      <path d="M3.75 6v1.25H8m4.25-1.25v1.25H8M8 7.25V10" strokeLinecap="round" />
    </svg>
  );
}

function IconStatistics() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2.25 13.5h11.5" strokeLinecap="round" />
      <path d="M3.5 11V7.75h2V11h-2Zm3.5 0V3.5h2V11H7Zm3.5 0V5.75h2V11h-2Z" strokeLinejoin="round" />
    </svg>
  );
}

function IconContribute() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2.25 4.25h7.5M2.25 8h5.5M2.25 11.75h4" strokeLinecap="round" />
      <path d="m10.2 10.7 3.45-3.45 1.1 1.1-3.45 3.45-1.65.55z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}
