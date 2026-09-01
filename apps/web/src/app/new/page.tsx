import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermForm } from "@/components/term-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listAssignableUsers } from "@/lib/terms/owners";
import { listBusinessCategories } from "@/lib/terms/categories";

// R135: 이 화면은 이제 `/new`(최상위)다. 슬러그는 `/w/` 아래에만 있으므로 더는
// 같은 네임스페이스에서 부딪히지 않지만, RESERVED_SLUGS의 "new"는 그대로 둔다 —
// 옛 주소 `/terms/new`가 next.config의 리다이렉트로 이 폼에 오기 때문에, 슬러그가
// "new"인 용어가 생기면 그 용어의 옛 링크가 폼으로 새어 들어간다.
export default async function NewTermPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [assignees, categoryOptions] = await Promise.all([listAssignableUsers(), listBusinessCategories()]);

  return (
    <AppShell user={user} title="새 용어" current="sheet" roomy>
      <nav className="mb-5 text-xs text-ink-3">
        <Link href="/sheet" className="link">
          시트
        </Link>
        <span className="mx-1.5">/</span>
        <span>새 용어</span>
      </nav>

      <header className="mb-5 border-b border-line pb-4">
        <p className="text-xl font-semibold tracking-tight lg:hidden">새 용어</p>
        {/* 표에서도 한 줄 추가가 되므로, 이 화면이 존재하는 이유(표기·정의까지
            한 번에 넣는 경우)를 한 줄로 알려준다. */}
        <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">
          아는 정보까지만 등록해도 괜찮습니다. 새 용어는 초안으로 시작해 기본 검색과 AI 조회에는 보이지 않고, <Link href="/contribute" className="link">함께 정리</Link>에서 이어서 채운 뒤 검토해 공개할 수 있습니다. 이름만 빠르게 추가하려면 <Link href="/sheet" className="link">시트</Link>의 마지막 줄을 쓰세요.
        </p>
      </header>

      <TermForm assignees={assignees} categoryOptions={categoryOptions} />
    </AppShell>
  );
}
