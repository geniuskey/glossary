import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ImportForm } from "@/components/import-form";
import { ImportGuide, TemplateDownloadLink } from "@/components/import-guide";
import { getCurrentUser } from "@/lib/auth/current-user";

// R121: app/new/page.tsx(R92)와 같은 Server-shell 패턴 —
// getCurrentUser로 미인증 접근을 redirect("/login")로 걷어내고, 실제 폼은
// "use client" 컴포넌트로 분리한다. /import는 app/terms/ 밑 세그먼트가
// 아니므로 create.ts의 RESERVED_SLUGS(R107)에는 등록 대상이 아니다.
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} title="엑셀 가져오기" current="import">
      <header className="mb-7 flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-line pb-5">
        <div>
          <p className="text-xl font-semibold tracking-tight lg:hidden">엑셀 가져오기</p>
          <p className="mt-1.5 max-w-xl text-sm text-ink-2">
            xlsx 파일 하나로 용어를 한꺼번에 올립니다. 먼저 검사만 실행해 충돌과 중복을 확인한 뒤 반영하세요.
            어떤 열을 읽는지는 아래 <span className="text-ink">파일은 이렇게 만듭니다</span>에 적어 두었습니다.
          </p>
        </div>
        <TemplateDownloadLink className="ml-auto shrink-0" />
      </header>
      <div className="space-y-8">
        <ImportForm />
        <ImportGuide />
      </div>
    </AppShell>
  );
}
