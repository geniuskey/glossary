import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ImportForm } from "@/components/import-form";
import { getCurrentUser } from "@/lib/auth/current-user";

// R121: app/terms/new/page.tsx(R92)와 같은 Server-shell 패턴 —
// getCurrentUser로 미인증 접근을 redirect("/login")로 걷어내고, 실제 폼은
// "use client" 컴포넌트로 분리한다. /import는 app/terms/ 밑 세그먼트가
// 아니므로 create.ts의 RESERVED_SLUGS(R107)에는 등록 대상이 아니다.
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <h1 className="mb-2 text-xl font-semibold">엑셀 임포트</h1>
      <p className="mb-6 text-sm text-slate-600">
        xlsx 파일을 올려 미리보기(dry-run)로 충돌/중복을 먼저 확인한 뒤 실제로 반영하세요.
      </p>
      <ImportForm />
    </AppShell>
  );
}
