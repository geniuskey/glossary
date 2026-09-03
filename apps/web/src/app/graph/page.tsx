import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GraphFilterBar } from "@/components/graph-filter-bar";
import { TermGraph } from "@/components/term-graph";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { listGraphTerms, termFacets } from "@/lib/terms/query";

export const metadata = { title: "용어 관계도" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, DOMAIN_VALUE_MAX) || undefined;
}

export default async function GraphPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const domain = first(params.domain);
  const rawCategory = first(params.category);
  const [facets, domainOptions] = await Promise.all([termFacets(), listDomains()]);
  const category = facets.categories.some((facet) => facet.value === rawCategory) ? rawCategory : undefined;
  const topic = first(params.topic) ?? (rawCategory && !category ? rawCategory : undefined);
  const terms = await listGraphTerms({ domain, category, topic, limit: 100 });

  return (
    <AppShell user={user} title="용어 관계도" current="graph" wide>
      <header className="shrink-0 border-b border-line bg-panel/70 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand lg:hidden">TERM MAP</p>
            <p className="mt-1 text-xl font-semibold lg:hidden">용어 관계도</p>
            <p className="mt-1 text-xs text-ink-3 lg:mt-0">{terms.length}개 용어 · 허브는 최대 18개, 용어는 최대 100개를 표시합니다.</p>
          </div>
          <GraphFilterBar
            values={{ domain: domain ?? "", category: category ?? "", topic: topic ?? "" }}
            domains={facets.domains.map((f) => ({ value: f.value, label: f.value }))}
            categories={facets.categories.map((f) => ({ value: f.value, label: f.label }))}
            topics={facets.topics.map((f) => ({ value: f.value, label: f.value }))}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <TermGraph terms={terms} domainColors={domainOptions.map(({ label, color }) => ({ label, color }))} />
      </div>
    </AppShell>
  );
}
