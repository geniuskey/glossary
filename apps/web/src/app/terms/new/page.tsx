import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";

// R92: "new"는 app/terms/ 밑 정적 세그먼트라 create.ts의 RESERVED_SLUGS에 이미
// 등록돼 있다("new") — 이 화면을 추가한다고 새로 등록할 이름은 없다.
export default async function NewTermPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} current="terms">
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/terms" className="link">
          용어집
        </Link>
        <span className="mx-1.5">/</span>
        <span>새 용어</span>
      </nav>

      <header className="mb-5 border-b border-line pb-4">
        <h1 className="text-xl font-semibold tracking-tight">새 용어</h1>
        {/* 표에서도 한 줄 추가가 되므로, 이 화면이 존재하는 이유(표기·정의까지
            한 번에 넣는 경우)를 한 줄로 알려준다. */}
        <p className="mt-0.5 text-xs text-ink-3">
          표기와 정의까지 한 번에 등록합니다. 이름만 빠르게 추가하려면 <Link href="/terms" className="link">용어집 표</Link>의 마지막 줄을 쓰세요.
        </p>
      </header>

      <TermForm />
    </AppShell>
  );
}
