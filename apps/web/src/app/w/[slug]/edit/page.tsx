import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiEditor } from "@/components/wiki-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { getWikiPageBySlug, toWikiPageWire } from "@/lib/wiki/store";

export const metadata = { title: "위키 문서 편집" };

export default async function EditWikiPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  const [page, domains] = await Promise.all([getWikiPageBySlug(slug), listDomains()]);
  if (!page) notFound();
  return <AppShell user={user} title={`${page.title} 편집`} current="wiki" roomy>
    <div className="space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Edit knowledge</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-ink">{page.title}</h1><p className="mt-2 text-sm leading-6 text-ink-2">변경할 때마다 리비전이 남습니다. 공개 상태를 초안으로 바꾸면 AI 검색에서 제외됩니다.</p></header>
      <WikiEditor initialPage={toWikiPageWire(page, true)} domains={domains.map((domain) => ({ key: domain.key, label: domain.label }))} />
    </div>
  </AppShell>;
}
