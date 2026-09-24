import Link from "next/link";
import { cx } from "@/lib/ui/format";

export const ADMIN_NAV_GROUPS = [
  {
    key: "workspace",
    label: "서비스 구성",
    items: [
      { key: "home", label: "홈 콘텐츠", description: "첫 화면 문구" },
      { key: "brand", label: "대표 색", description: "브랜드 프리셋" },
      { key: "menus", label: "메뉴 구성", description: "부가 기능 표시" },
      { key: "quality", label: "콘텐츠 완성도", description: "용어 작성 기준" },
    ],
  },
  {
    key: "ai-search",
    label: "AI · 검색",
    items: [
      { key: "ai", label: "AI 연결", description: "챗봇 · 자동 검토" },
      { key: "rag", label: "검색 인프라", description: "Embedding · RAG" },
      { key: "observability", label: "AI 운영", description: "호출 · 큐 · 실패" },
    ],
  },
  {
    key: "access",
    label: "조직 · 접근",
    items: [
      { key: "users", label: "사용자", description: "역할 · 세션" },
      { key: "sso", label: "로그인 · SSO", description: "인증 방식" },
    ],
  },
  {
    key: "data",
    label: "데이터",
    items: [
      { key: "data", label: "데이터 내보내기", description: "용어집 스냅샷" },
    ],
  },
] as const;

export type AdminTab = (typeof ADMIN_NAV_GROUPS)[number]["items"][number]["key"] | "overview";

function tabHref(tab: AdminTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}

function navLinkClass(active: boolean): string {
  return cx(
    "group flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
    active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
  );
}

export function AdminNavigation({ current }: { current: AdminTab }) {
  return (
    <aside className="mb-8 lg:mb-0" aria-label="관리자 메뉴">
      <div className="rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-20 lg:border-0 lg:bg-transparent lg:p-0">
        <p className="px-3 pb-2 text-[11px] font-semibold text-ink-3">관리자 메뉴</p>
        <nav className="grid gap-5 sm:grid-cols-2 lg:block" aria-label="관리자 하위 메뉴">
          <div>
            <Link
              href={tabHref("overview")}
              aria-current={current === "overview" ? "page" : undefined}
              className={navLinkClass(current === "overview")}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-2 text-xs" aria-hidden="true">⌂</span>
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
                    href={tabHref(item.key)}
                    aria-current={current === item.key ? "page" : undefined}
                    className={navLinkClass(current === item.key)}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-2 text-[10px] font-semibold text-ink-3" aria-hidden="true">
                      {item.label.slice(0, 1)}
                    </span>
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
