import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiIndexPanel } from "@/components/wiki-index-panel";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listWikiPages, toWikiPageWire } from "@/lib/wiki/store";

export const metadata = { title: "위키 지식 창고" };

export default async function WikiIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const pages = await listWikiPages({ page: 1, pageSize: 100 });
  return <AppShell user={user} title="위키 지식 창고" current="wiki" roomy>
    <WikiIndexPanel initialPages={pages.items.map((page) => toWikiPageWire(page))} />
  </AppShell>;
}
