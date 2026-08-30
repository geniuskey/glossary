import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listManagedUsers } from "@/lib/admin/users";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getHomeContent } from "@/lib/workspace/home-content";
import { getIdentityDisplaySettings } from "@/lib/workspace/identity-display";
import { HomeContentPanel } from "./home-content-panel";
import { IdentityDisplayPanel } from "./identity-display-panel";
import { UsersPanel } from "./users-panel";

export const metadata = { title: "관리자" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [managedUsers, homeContent, identityDisplay] = await Promise.all([
    listManagedUsers(),
    getHomeContent(),
    getIdentityDisplaySettings(),
  ]);

  return (
    <AppShell user={user} current="admin">
      <header className="mb-8 border-b border-line pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-brand">워크스페이스 관리</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance">관리자 패널</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
              워크스페이스의 첫인상과 구성원의 접근 권한을 관리합니다.
            </p>
          </div>
          <Link href="/settings/sso" className="btn-ghost shrink-0 self-start sm:self-auto">
            SSO 설정 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <HomeContentPanel initialContent={homeContent} />
      <div className="my-10 border-t border-line" />
      <IdentityDisplayPanel initialSettings={identityDisplay} />
      <div className="my-10 border-t border-line" />
      <UsersPanel initialUsers={managedUsers} viewerId={user.id} />
    </AppShell>
  );
}
