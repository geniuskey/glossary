import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { cx } from "@/lib/ui/format";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

export type NavKey = "search" | "sheet" | "import" | "keys" | "sso";

const NAV: Array<{ key: NavKey; href: string; label: string; hint: string; icon: ReactNode; adminOnly?: true }> = [
  // R135: 홈은 검색 화면이다. 사이드바 첫 자리를 검색이 가져가는 이유는
  // 이 사전에서 가장 자주 하는 일이 "찾기"이기 때문이다 — 표를 여는 것은
  // 고칠 때뿐이다.
  { key: "search", href: "/", label: "검색", hint: "홈", icon: <IconSearch /> },
  { key: "sheet", href: "/sheet", label: "시트", hint: "표 편집", icon: <IconGrid /> },
  { key: "import", href: "/import", label: "가져오기", hint: "엑셀", icon: <IconImport /> },
  { key: "keys", href: "/settings/api-keys", label: "API 키", hint: "AI-Lint", icon: <IconKey /> },
  // R132: SSO 설정은 관리자 전용이다. 편집자에게 보여 봐야 들어가면 /terms로
  // 되돌려지므로, 링크 자체를 감춰 막힌 문을 두드리게 하지 않는다.
  { key: "sso", href: "/settings/sso", label: "SSO", hint: "회사 계정", icon: <IconShield />, adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = { admin: "관리자", editor: "편집자" };

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
  current,
  wide = false,
  children,
}: {
  user: CurrentUser | null;
  current?: NavKey;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:flex">
      {/* 좁은 화면: 상단 바. 넓은 화면: 왼쪽 고정 사이드바. 하나의 마크업으로
          둘 다 처리해서 네비게이션 항목이 두 곳에 중복되지 않게 한다. */}
      <aside
        className="sticky top-0 z-30 shrink-0 border-b border-line bg-panel/85 backdrop-blur
          lg:h-screen lg:w-60 lg:border-b-0 lg:border-r"
      >
        <div className="flex h-14 items-center gap-3 px-4 lg:h-auto lg:flex-col lg:items-stretch lg:gap-0 lg:px-0 lg:py-5">
          <Link href="/" className="flex items-center gap-2.5 lg:px-4 lg:pb-6" aria-label="Grossary 홈">
            <BrandMark />
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-ink">Grossary</span>
              <span className="mt-0.5 hidden text-[10px] uppercase tracking-[0.16em] text-ink-3 lg:block">
                용어집
              </span>
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto lg:flex-none lg:flex-col lg:items-stretch lg:gap-0.5 lg:px-2">
            {NAV.filter((item) => !item.adminOnly || user?.role === "admin").map((item) => {
              const active = item.key === current;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                    active
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  <span className={cx("shrink-0", active ? "text-brand" : "text-ink-3 group-hover:text-ink-2")}>
                    {item.icon}
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                  <span className="ml-auto hidden text-[10px] text-ink-3 lg:block">{item.hint}</span>
                </Link>
              );
            })}
          </nav>

          {/* 좁은 화면에서는 사용자 정보를 상단 바 오른쪽에, 넓은 화면에서는
              사이드바 맨 아래에 둔다. */}
          <div className="ml-auto flex items-center gap-1 lg:ml-0 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-2 lg:px-2 lg:pt-6">
            {user && <UserChip user={user} />}
            <div className="flex items-center gap-1 lg:justify-between lg:px-1">
              <ThemeToggle />
              {user && <LogoutButton />}
            </div>
          </div>
        </div>
      </aside>

      <main
        className={cx(
          "min-w-0 flex-1",
          wide
            ? "flex min-h-0 flex-col lg:h-screen lg:overflow-hidden"
            : "mx-auto w-full max-w-4xl px-5 py-8 lg:px-8",
        )}
      >
        {children}
      </main>
    </div>
  );
}

function UserChip({ user }: { user: CurrentUser }) {
  const label = user.name || user.email;
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1 lg:bg-panel-2 lg:px-2 lg:py-2">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[11px]
          font-semibold text-brand-on"
        aria-hidden
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden min-w-0 flex-col leading-tight lg:flex">
        <span className="truncate text-xs font-medium text-ink">{label}</span>
        <span className="text-[10px] text-ink-3">{ROLE_LABEL[user.role] ?? user.role}</span>
      </span>
    </div>
  );
}

/** 색인 카드 세 장이 겹친 모양 — 이 앱이 다루는 것(한 개념 = 표기 여러 장)의 그림.
 *  홈(검색 화면)은 이 셸을 쓰지 않지만 같은 마크를 크게 쓰므로 export한다 —
 *  두 벌을 두면 한쪽만 고쳐져 로고가 화면마다 달라진다. */
export function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden className="shrink-0">
      <rect x="3" y="6" width="18" height="15" rx="2.5" className="fill-brand/20" />
      <rect x="4.5" y="3.5" width="18" height="15" rx="2.5" className="fill-panel stroke-brand" strokeWidth="1.5" />
      <path d="M8.5 8.5h10M8.5 11.5h10M8.5 14.5h6" className="stroke-brand" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.25 3.25" strokeLinecap="round" />
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

function IconShield() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 1.75 13 3.5v4.25c0 3-2.1 5.3-5 6.5-2.9-1.2-5-3.5-5-6.5V3.5z" strokeLinejoin="round" />
      <path d="M5.75 8.1 7.4 9.75l3-3.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="5.25" cy="10.75" r="3" />
      <path d="m7.5 8.5 6-6M11 5l1.75 1.75M9.5 6.5l1.75 1.75" strokeLinecap="round" />
    </svg>
  );
}
