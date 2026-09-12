import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ImportForm } from "@/components/import-form";
import { ImportReview } from "@/components/import-review";
import { ImportGuide, TemplateDownloadLink } from "@/components/import-guide";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listBusinessCategories } from "@/lib/terms/categories";

// R121: app/new/page.tsx(R92)와 같은 Server-shell 패턴 —
// getCurrentUser로 미인증 접근을 redirect("/login")로 걷어내고, 실제 폼은
// "use client" 컴포넌트로 분리한다. /import는 app/terms/ 밑 세그먼트가
// 아니므로 create.ts의 RESERVED_SLUGS(R107)에는 등록 대상이 아니다.
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const categoryOptions = await listBusinessCategories();

  return (
    <AppShell user={user} title="엑셀 가져오기" current="import">
      <header className="mb-7 flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-line pb-5">
        <div>
          <p className="text-xl font-semibold tracking-tight lg:hidden">엑셀 가져오기</p>
          <p className="mt-1.5 max-w-xl text-sm text-ink-2">
            기존 영문·한글 엑셀을 그대로 올리거나 복사해 붙여넣으세요.
            분리 결과를 확인하고, 애매한 행은 하나씩 수정·승인한 뒤 등록합니다.
          </p>
        </div>
        <TemplateDownloadLink className="ml-auto shrink-0" />
      </header>
      <div className="space-y-8">
        <ImportReview />
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium">상세 열로 가져오기 · 기존 형식 및 템플릿 안내</summary>
          <div className="mt-5 space-y-8">
            <p className="text-sm text-ink-2">약어·확장명·비권장 표기 등을 이미 별도 열로 정리한 파일에 사용합니다. 이 방식은 대표명 셀을 나누지 않습니다.</p>
            <ImportForm />
            <ImportGuide categoryOptions={categoryOptions} />
          </div>
        </details>
      </div>
    </AppShell>
  );
}
