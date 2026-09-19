import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiEditor } from "@/components/wiki-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";

export const metadata = { title: "새 위키 문서" };

export default async function NewWikiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const domains = await listDomains();
  return <AppShell user={user} title="새 위키 문서" current="wiki" roomy>
    <div className="space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">New knowledge</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">새 위키 문서</h1><p className="mt-2 text-sm leading-6 text-ink-2">용어를 업무 맥락으로 설명하는 문서를 만드세요. 공개하기 전에는 AI 검색에 사용되지 않습니다.</p></header>
      <WikiEditor initialPage={null} domains={domains.map((domain) => ({ key: domain.key, label: domain.label }))} />
    </div>
  </AppShell>;
}
