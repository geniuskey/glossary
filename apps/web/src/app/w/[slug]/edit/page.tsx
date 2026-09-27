import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiEditor } from "@/components/wiki-editor";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { getWikiPageBySlug, listWikiTagOptions, toWikiPageWire } from "@/lib/wiki/store";

export const metadata = { title: "위키 문서 편집" };

export default async function EditWikiPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  const [page, domains, tags] = await Promise.all([getWikiPageBySlug(slug), listDomains(), listWikiTagOptions()]);
  if (!page) notFound();
  return <AppShell user={user} title={`${page.title} 편집`} current="wiki" roomy dense>
    <div>
    <WikiEditor initialPage={toWikiPageWire(page, true)} domains={domains.map((domain) => ({ key: domain.key, label: domain.label }))} tagOptions={tags.map((tag) => tag.value)} canPublish={user.role === "admin"} />
    </div>
  </AppShell>;
}
