import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ApiKeysPanel } from "./api-keys-panel";

export const metadata = { title: "API 키" };

export default async function ApiKeysPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} title="API 키" current="settings">
      <header className="mb-8 border-b border-line pb-5">
        <Link href="/settings" className="text-sm text-ink-3 hover:text-ink">← 설정</Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink text-balance">API 키</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
          외부 도구에서 사용할 키를 용도별로 발급하고, 더 쓰지 않는 키는 폐기하세요.
        </p>
      </header>
      <ApiKeysPanel />
    </AppShell>
  );
}
