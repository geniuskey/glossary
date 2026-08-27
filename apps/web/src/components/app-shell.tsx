import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { LogoutButton } from "./logout-button";

export function AppShell({ user, children }: { user: CurrentUser | null; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/terms" className="font-semibold">
            용어집
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/terms/new" className="text-slate-600 hover:text-slate-900">
              새 용어
            </Link>
            <Link href="/import" className="text-slate-600 hover:text-slate-900">
              임포트
            </Link>
            <Link href="/settings/api-keys" className="text-slate-600 hover:text-slate-900">
              API 키
            </Link>
            <span className="text-slate-400">{user?.name ?? ""}</span>
            {user && <LogoutButton />}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
