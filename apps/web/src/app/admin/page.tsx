import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listManagedBusinessCategories } from "@/lib/terms/categories";
import { getHomeContent } from "@/lib/workspace/home-content";
import { HomeContentPanel } from "./home-content-panel";
import { UsersPanel } from "./users-panel";
import { CategoriesPanel } from "./categories-panel";

export const metadata = { title: "관리자" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [managedUsers, homeContent, categories] = await Promise.all([
    listManagedUsers(),
    getHomeContent(),
    listManagedBusinessCategories(),
  ]);

  return (
    <AppShell user={user} title="관리자 패널" current="admin">
      <header className="mb-8 border-b border-line pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-brand">워크스페이스 관리</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-balance lg:hidden">관리자 패널</p>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
              워크스페이스의 첫인상, 업무 분류와 구성원의 접근 권한을 관리합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            <Link href="/statistics" className="btn-ghost">플랫폼 통계 <span aria-hidden="true">→</span></Link>
            <Link href="/settings/sso" className="btn-ghost">SSO 설정 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </header>

      <HomeContentPanel initialContent={homeContent} />
      <div className="my-10 border-t border-line" />
      <CategoriesPanel initialCategories={categories} />
      <div className="my-10 border-t border-line" />
      <UsersPanel initialUsers={managedUsers} viewerId={user.id} />
    </AppShell>
  );
}
