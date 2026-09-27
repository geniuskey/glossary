import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WikiIndexPanel } from "@/components/wiki-index-panel";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseWikiPageSize } from "@/lib/wiki/list-params";
import { countWikiPages, listWikiPages, listWikiTagOptions, toWikiPageWire } from "@/lib/wiki/store";

export const metadata = { title: "위키 지식 창고" };

export default async function WikiIndexPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const rawQuery = typeof params.q === "string" ? params.q : Array.isArray(params.q) ? params.q[0] ?? "" : "";
  const query = rawQuery.trim().slice(0, 200);
  const rawPage = typeof params.page === "string" ? params.page : Array.isArray(params.page) ? params.page[0] ?? "" : "";
  const requestedPage = Math.min(100_000, Math.max(1, Number.parseInt(rawPage, 10) || 1));
  const rawPageSize = typeof params.pageSize === "string" ? params.pageSize : Array.isArray(params.pageSize) ? params.pageSize[0] ?? "" : "";
  const pageSize = parseWikiPageSize(rawPageSize);
  const rawTag = typeof params.tag === "string" ? params.tag : Array.isArray(params.tag) ? params.tag[0] ?? "" : "";
  const tag = rawTag.trim().slice(0, 200);
  const [firstResult, overallTotal, tagOptions] = await Promise.all([
    listWikiPages({ query: query || undefined, tag: tag || undefined, page: requestedPage, pageSize }),
    countWikiPages(),
    listWikiTagOptions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(firstResult.total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const result = page === requestedPage
    ? firstResult
    : await listWikiPages({ query: query || undefined, tag: tag || undefined, page, pageSize });
  const tags = tagOptions.map((item) => item.value);
  if (tag && !tags.includes(tag)) tags.unshift(tag);
  return <AppShell user={user} title="위키" current="wiki" roomy>
    <WikiIndexPanel
      initialPages={result.items.map((item) => toWikiPageWire(item))}
      query={query}
      tag={tag}
      tagOptions={tags}
      page={page}
      pageSize={pageSize}
      total={result.total}
      totalPages={totalPages}
      overallTotal={overallTotal}
    />
  </AppShell>;
}
