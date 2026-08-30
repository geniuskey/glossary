import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SsoSettingsForm } from "./sso-settings-form";

export const metadata = { title: "SSO" };

export default async function SsoSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // 화면을 막는 것만으로는 부족하고 /api/v1/sso도 requireAdminUser로 막혀 있다.
  // 여기서 되돌리는 것은 편집자에게 못 채우는 폼을 보여 주지 않기 위해서다.
  if (user.role !== "admin") redirect("/");

  return (
    <AppShell user={user} current="settings">
      <header className="mb-7 border-b border-line pb-5">
        <Link href="/settings" className="mb-3 inline-flex text-xs font-medium text-ink-2 hover:text-ink">
          ← 설정으로 돌아가기
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">SSO 연결</h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink-2">
          회사 계정(OpenID Connect)으로 로그인하게 만듭니다. IdP가 보내는 값의 이름은 회사마다
          달라서, 어떤 값을 이름과 그룹으로 쓸지 여기서 직접 정합니다.
        </p>
      </header>

      <SsoSettingsForm />
    </AppShell>
  );
}
