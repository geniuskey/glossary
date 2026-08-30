import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ApiKeysPanel } from "./api-keys/api-keys-panel";

export const metadata = { title: "설정" };

const ROLE_LABEL = { admin: "관리자", editor: "편집자" } as const;

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const displayName = user.name || user.email;

  return (
    <AppShell user={user} current="settings">
      <header className="mb-8 border-b border-line pb-5">
        <p className="text-xs font-semibold tracking-[0.16em] text-brand">내 환경</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance">설정</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
          계정과 화면 환경을 확인하고, Grossary를 외부 도구와 연결할 API 키를 관리합니다.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5" aria-labelledby="account-heading">
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-on"
              aria-hidden="true"
            >
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 id="account-heading" className="font-semibold text-ink text-balance">내 계정</h2>
              <p className="mt-1 truncate text-sm text-ink-2">{displayName}</p>
              <p className="mt-0.5 break-all text-xs text-ink-3">{user.email}</p>
            </div>
            <span className="chip ml-auto shrink-0">{ROLE_LABEL[user.role]}</span>
          </div>
          <p className="mt-4 border-t border-line pt-4 text-xs leading-5 text-ink-3">
            이름과 이메일은 로그인 계정에서 관리됩니다.
          </p>
        </section>

        <section className="card flex flex-col p-5" aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className="font-semibold text-ink text-balance">화면</h2>
          <p className="mt-1 text-sm leading-6 text-ink-2">
            시스템 설정을 따르거나 밝은 화면과 어두운 화면을 직접 선택할 수 있습니다.
          </p>
          <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
            <span className="text-xs font-medium text-ink-3">색상 테마</span>
            <ThemeToggle alwaysShowLabel />
          </div>
        </section>
      </div>

      {user.role === "admin" && (
        <section className="card mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center" aria-labelledby="workspace-heading">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand">관리자 전용</p>
            <h2 id="workspace-heading" className="mt-1 font-semibold text-ink text-balance">관리자 패널</h2>
            <p className="mt-1 text-sm leading-6 text-ink-2">
              사용자 역할과 로그인 세션을 관리하고 회사 로그인 설정으로 이동합니다.
            </p>
          </div>
          <Link href="/admin" className="btn-ghost shrink-0 self-start sm:self-auto">
            관리자 패널 열기 <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}

      <section id="api-keys" className="scroll-mt-6 border-t border-line pt-8 mt-10" aria-labelledby="api-keys-heading">
        <div className="mb-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-brand">개발자 설정</p>
          <h2 id="api-keys-heading" className="mt-1 text-lg font-semibold tracking-tight text-ink text-balance">API 키</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">
            AI 린트나 외부 도구가 이 사전을 조회하고 검사할 때 씁니다. 용도마다 별도 키를 발급하고,
            더 쓰지 않는 키는 바로 폐기하세요.
          </p>
        </div>
        <ApiKeysPanel />
      </section>
    </AppShell>
  );
}
