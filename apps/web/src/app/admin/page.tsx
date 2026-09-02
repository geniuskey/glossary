import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getHomeContent } from "@/lib/workspace/home-content";
import { getTermQualitySettings } from "@/lib/workspace/term-quality";
import { cx } from "@/lib/ui/format";
import { HomeContentPanel } from "./home-content-panel";
import { TermQualityPanel } from "./term-quality-panel";
import { UsersPanel } from "./users-panel";

export const metadata = { title: "관리자" };

const ADMIN_TABS = [
  { key: "home", label: "홈 화면" },
  { key: "quality", label: "작성 수준" },
  { key: "users", label: "사용자" },
] as const;
type AdminTab = (typeof ADMIN_TABS)[number]["key"];

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const rawTab = (await searchParams).tab;
  const requestedTab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab: AdminTab = ADMIN_TABS.some((item) => item.key === requestedTab) ? requestedTab as AdminTab : "home";

  const [managedUsers, homeContent, termQuality] = await Promise.all([
    listManagedUsers(),
    getHomeContent(),
    getTermQualitySettings(),
  ]);

  return (
    <AppShell user={user} title="관리자 패널" current="admin" roomy>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xl font-semibold tracking-tight lg:hidden">관리자 패널</p>
          <Link href="/statistics" className="btn-ghost btn-sm">통계</Link>
          <Link href="/classifications" className="btn-ghost btn-sm">분류 체계</Link>
          <Link href="/settings/sso" className="btn-ghost btn-sm">SSO</Link>
        </div>
        <nav className="mt-4 flex border-b border-line" aria-label="관리자 하위 메뉴">
          {ADMIN_TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === "home" ? "/admin" : `/admin?tab=${item.key}`}
              aria-current={tab === item.key ? "page" : undefined}
              className={cx(
                "relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition",
                tab === item.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "home" && <HomeContentPanel initialContent={homeContent} />}
      {tab === "quality" && <TermQualityPanel initialSettings={termQuality} />}
      {tab === "users" && <UsersPanel initialUsers={managedUsers} viewerId={user.id} />}
    </AppShell>
  );
}
