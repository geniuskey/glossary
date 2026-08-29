import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";

// R135: 이 화면은 이제 `/new`(최상위)다. 슬러그는 `/w/` 아래에만 있으므로 더는
// 같은 네임스페이스에서 부딪히지 않지만, RESERVED_SLUGS의 "new"는 그대로 둔다 —
// 옛 주소 `/terms/new`가 next.config의 리다이렉트로 이 폼에 오기 때문에, 슬러그가
// "new"인 용어가 생기면 그 용어의 옛 링크가 폼으로 새어 들어간다.
export default async function NewTermPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} current="sheet">
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/sheet" className="link">
          시트
        </Link>
        <span className="mx-1.5">/</span>
        <span>새 용어</span>
      </nav>

      <header className="mb-5 border-b border-line pb-4">
        <h1 className="text-xl font-semibold tracking-tight">새 용어</h1>
        {/* 표에서도 한 줄 추가가 되므로, 이 화면이 존재하는 이유(표기·정의까지
            한 번에 넣는 경우)를 한 줄로 알려준다. */}
        <p className="mt-0.5 text-xs text-ink-3">
          표기와 정의까지 한 번에 등록합니다. 이름만 빠르게 추가하려면 <Link href="/sheet" className="link">시트</Link>의 마지막 줄을 쓰세요.
        </p>
      </header>

      <TermForm />
    </AppShell>
  );
}
