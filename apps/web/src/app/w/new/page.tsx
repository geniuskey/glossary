import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiEditor } from "@/components/wiki-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";

export const metadata = { title: "새 위키 문서" };

export default async function NewWikiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const fromMeeting = params.from === "meeting";
  const rawSourceUrl = Array.isArray(params.sourceUrl) ? params.sourceUrl[0] : params.sourceUrl;
  const initialSourceUrl = rawSourceUrl && /^https?:\/\//i.test(rawSourceUrl) ? rawSourceUrl.slice(0, 2_000) : null;
  const domains = await listDomains();
  return <AppShell user={user} title="새 위키 문서" current="wiki" roomy dense>
    <div className="space-y-3">
      {fromMeeting && <div className="note-ok"><p className="font-medium">회의록에서 지식 승격</p><p className="mt-1 text-xs leading-5">초안으로 저장한 뒤 출처 URL을 확인하고 공개하세요. 공개된 위키만 AI의 공식 맥락으로 사용됩니다.</p></div>}
      <WikiEditor initialPage={initialSourceUrl ? { title: "", summary: null, sourceUrl: initialSourceUrl, domain: [], status: "draft", terms: [] } : null} domains={domains.map((domain) => ({ key: domain.key, label: domain.label }))} canPublish={user.role === "admin"} />
    </div>
  </AppShell>;
}
