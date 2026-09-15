import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GraphFilterBar } from "@/components/graph-filter-bar";
import { TermGraph } from "@/components/term-graph";
import { SemanticGraphWorkspace } from "@/components/semantic-graph-workspace";
import { semanticGraphRelations } from "@/lib/terms/relations";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { listGraphTermsWithTotal, termFacets } from "@/lib/terms/query";

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
  const { items: terms, total } = await listGraphTermsWithTotal({ domain, category, topic, limit: 100 });
  const semantic = first(params.view) === "semantic";
  const relations = semantic ? await semanticGraphRelations(terms.map((term) => term.id)) : { items: [], omitted: 0 };
  const filters = new URLSearchParams();
  if (domain) filters.set("domain", domain);
  if (category) filters.set("category", category);
  if (topic) filters.set("topic", topic);
  const classificationHref = filters.size ? `/graph?${filters}` : "/graph";
  filters.set("view", "semantic");
  const semanticHref = `/graph?${filters}`;
  const number = new Intl.NumberFormat("ko-KR");
  const graphTopBar = (
    <>
      <span
        className="max-w-52 truncate text-[11px] text-ink-3"
        title={semantic
          ? `승인된 의미 관계 ${relations.items.length}개 표시${relations.omitted > 0 ? ` · 연결 ${relations.omitted}개 생략` : ""}`
          : `전체 ${number.format(total)}개 중 ${number.format(terms.length)}개 표시`}
      >
        {semantic ? `관계 ${number.format(relations.items.length)}개` : `${number.format(terms.length)} / ${number.format(total)}개`}
      </span>
      <nav className="flex shrink-0 gap-1.5" aria-label="관계도 보기">
        <Link href={classificationHref} aria-current={!semantic ? "page" : undefined} className={!semantic ? "btn-primary h-8 px-2.5 text-xs" : "btn-ghost h-8 px-2.5 text-xs"}>분류 관계</Link>
        <Link href={semanticHref} aria-current={semantic ? "page" : undefined} className={semantic ? "btn-primary h-8 px-2.5 text-xs" : "btn-ghost h-8 px-2.5 text-xs"}>의미 관계</Link>
      </nav>
      <GraphFilterBar
        values={{ domain: domain ?? "", category: category ?? "", topic: topic ?? "" }}
        domains={facets.domains.map((f) => ({ value: f.value, label: f.value }))}
        categories={facets.categories.map((f) => ({ value: f.value, label: f.label }))}
        topics={facets.topics.map((f) => ({ value: f.value, label: f.value }))}
        view={semantic ? "semantic" : undefined}
      />
    </>
  );

  return (
    <AppShell user={user} title="용어 관계도" current="graph" wide>
      <div className="min-h-0 flex-1 overflow-auto">
        {semantic ? <SemanticGraphWorkspace terms={terms} relations={relations.items} domainColors={domainOptions.map(({ label, color }) => ({ label, color }))} topBar={graphTopBar} />
          : <TermGraph terms={terms} domainColors={domainOptions.map(({ label, color }) => ({ label, color }))} topBar={graphTopBar} />}
      </div>
    </AppShell>
  );
}
