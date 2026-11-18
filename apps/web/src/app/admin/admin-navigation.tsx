import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/ui/format";

export const ADMIN_NAV_GROUPS = [
  {
    key: "workspace",
    label: "서비스 구성",
    items: [
      { key: "home", label: "홈 화면", description: "입력 방식 · 소개 문구" },
      { key: "brand", label: "대표 색", description: "브랜드 프리셋" },
      { key: "menus", label: "메뉴 구성", description: "표시 · 순서" },
      { key: "quality", label: "콘텐츠 완성도", description: "보완 현황" },
    ],
  },
  {
    key: "ai-search",
    label: "AI · 검색",
    items: [
      { key: "ai", label: "AI 연결", description: "챗봇 · 자동 검토" },
      { key: "rag", label: "검색 인프라", description: "Embedding · 색인" },
      { key: "observability", label: "AI 운영", description: "호출 · 큐 · 실패" },
    ],
  },
  {
    key: "access",
    label: "조직 · 접근",
    items: [
      { key: "users", label: "사용자", description: "역할 · 세션 · 에이전트" },
      { key: "sso", label: "로그인 방식", description: "Google · 회사 SSO" },
    ],
  },
  {
    key: "data",
    label: "데이터",
    items: [
      { key: "data", label: "백업 · 동기화", description: "스냅샷 · 서버 번들" },
    ],
  },
] as const;

export type AdminTab = (typeof ADMIN_NAV_GROUPS)[number]["items"][number]["key"] | "overview";

/** 예전 주소. 북마크와 다른 화면의 안내 문구가 그대로 열리도록 새 탭으로 옮겨 준다. */
export const ADMIN_TAB_ALIASES: Record<string, AdminTab> = { sync: "data" };

export function adminTabHref(tab: AdminTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}

function navLinkClass(active: boolean): string {
  return cx(
    "group flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
  );
}

function iconClass(active: boolean): string {
  return cx(
    "grid h-7 w-7 shrink-0 place-items-center rounded-md",
    active ? "bg-brand/10 text-brand" : "bg-panel-2 text-ink-3 group-hover:text-ink-2",
  );
}

export function AdminNavigation({ current }: { current: AdminTab }) {
  return (
    <aside className="mb-8 lg:mb-0" aria-label="관리자 메뉴">
      <div className="rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-20 lg:border-0 lg:bg-transparent lg:p-0">
        <nav className="grid gap-5 sm:grid-cols-2 lg:block" aria-label="관리자 하위 메뉴">
          <div>
            <Link
              href={adminTabHref("overview")}
              aria-current={current === "overview" ? "page" : undefined}
              className={navLinkClass(current === "overview")}
            >
              <span className={iconClass(current === "overview")} aria-hidden="true">{ADMIN_NAV_ICONS.overview}</span>
              <span className="min-w-0">
                <span className="block truncate">운영 개요</span>
                <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-3 group-hover:text-ink-2">상태와 확인할 일</span>
              </span>
            </Link>
          </div>

          {ADMIN_NAV_GROUPS.map((group) => (
            <section key={group.key} className="lg:mt-5" aria-labelledby={`admin-nav-${group.key}`}>
              <h2 id={`admin-nav-${group.key}`} className="px-3 pb-1.5 text-[11px] font-semibold text-ink-3">{group.label}</h2>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Link
                    key={item.key}
                    href={adminTabHref(item.key)}
                    aria-current={current === item.key ? "page" : undefined}
                    className={navLinkClass(current === item.key)}
                  >
                    <span className={iconClass(current === item.key)} aria-hidden="true">{ADMIN_NAV_ICONS[item.key]}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-3 group-hover:text-ink-2">{item.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

// 이름 첫 글자를 아이콘 자리에 쓰면 "AI 연결"과 "AI 운영"이 같은 A가 된다.
// 탭마다 다른 모양을 주되 앱 사이드바 아이콘과 같은 선 굵기·크기로 맞춘다.
const ADMIN_NAV_ICONS: Record<AdminTab, ReactNode> = {
  overview: <Icon><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="3" rx="1" /><rect x="9" y="7" width="5" height="7" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /></Icon>,
  home: <Icon><path d="M2.5 7.25 8 2.75l5.5 4.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7.25Z" /><path d="M6.25 14v-4h3.5v4" /></Icon>,
  brand: <Icon><circle cx="8" cy="8" r="5.75" /><path d="M8 2.25v11.5" /><path d="M8 2.25a5.75 5.75 0 0 1 0 11.5" fill="currentColor" stroke="none" /></Icon>,
  menus: <Icon><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.75" cy="4" r=".6" fill="currentColor" /><circle cx="2.75" cy="8" r=".6" fill="currentColor" /><circle cx="2.75" cy="12" r=".6" fill="currentColor" /></Icon>,
  quality: <Icon><path d="M3 2.75h7.5L13 5.25v8a.75.75 0 0 1-.75.75h-9.5A.75.75 0 0 1 2 13.25v-9.5A1 1 0 0 1 3 2.75Z" /><path d="m5.25 9 1.75 1.75 3.75-4" /></Icon>,
  ai: <Icon><path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" /><path d="M8 4.75 9 7l2.25 1L9 9l-1 2.25L7 9 4.75 8 7 7l1-2.25Z" /></Icon>,
  rag: <Icon><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3.5 3.5" /><path d="M5 7h4M7 5v4" /></Icon>,
  observability: <Icon><path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5 1 1.5h3.25" /></Icon>,
  users: <Icon><circle cx="6" cy="5.25" r="2.5" /><path d="M1.75 13.5c.5-2.4 2.15-3.75 4.25-3.75s3.75 1.35 4.25 3.75" /><path d="M10.5 3a2.25 2.25 0 0 1 0 4.5M12 9.9c1.2.5 2 1.6 2.25 3.6" /></Icon>,
  sso: <Icon><rect x="3" y="7" width="10" height="7" rx="1.25" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /><path d="M8 9.75v1.5" /></Icon>,
  data: <Icon><ellipse cx="8" cy="3.75" rx="5.25" ry="1.75" /><path d="M2.75 3.75v8.5c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75v-8.5" /><path d="M2.75 8c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75" /></Icon>,
};
