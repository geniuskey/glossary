import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GraphFilterBar } from "@/components/graph-filter-bar";
import { TermGraph } from "@/components/term-graph";
import { SemanticGraphWorkspace } from "@/components/semantic-graph-workspace";
import { semanticGraphOverview } from "@/lib/terms/relations";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { graphTermBySlug, graphTermsByIds, listGraphTermsWithTotal, termFacets } from "@/lib/terms/query";
import { expandApprovedOntology } from "@/lib/ontology/expand";
import { loadOntologyPredicates } from "@/lib/ontology/catalog";
import { getDb } from "@/lib/db";

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
  const topic = first(params.tag ?? params.topic) ?? (rawCategory && !category ? rawCategory : undefined);
  // 기존 /graph?domain=... 링크는 분류 지도로 유지한다. 필터 없는 기본 화면은
  // 실제 승인 관계와 근거를 먼저 보여준다.
  const semantic = first(params.view) === "semantic" || (first(params.view) !== "classification" && !domain && !category && !topic);
  const semanticPanel = first(params.panel) === "manage" ? "manage" : "explore";
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focusSlug = semantic ? rawFocus?.trim().slice(0, 200) || undefined : undefined;
  const focusTerm = focusSlug ? await graphTermBySlug(focusSlug) : null;
  const overview = semantic ? await semanticGraphOverview() : null;
  const predicates = semantic && semanticPanel === "explore" && focusTerm ? await loadOntologyPredicates() : [];
  const expansion = semantic && semanticPanel === "explore" && focusTerm ? await expandApprovedOntology(getDb(), [focusTerm.id], predicates, { maxDepth: 2, limit: 80 }) : null;
  const relations = focusTerm && expansion
    ? expansion.relations.map(({ id, sourceTermId, targetTermId, relationType, evidenceMd }) => ({ id, sourceTermId, targetTermId, relationType, evidenceMd }))
    : semanticPanel === "explore" ? overview?.items ?? [] : [];
  const paths = expansion?.paths.map((path) => ({
    ...path,
    predicateLabel: predicates.find((predicate) => predicate.key === path.predicateKey)?.label ?? path.predicateKey,
  })) ?? [];
  const semanticTermIds = focusTerm
    ? [...new Set([focusTerm.id, ...relations.flatMap((relation) => [relation.sourceTermId, relation.targetTermId])])]
    : overview?.termIds ?? [];
  const semanticTerms = semantic && semanticPanel === "explore" ? await graphTermsByIds(semanticTermIds) : [];
  const classification = semantic ? null : await listGraphTermsWithTotal({ domain, category, topic, limit: 100 });
  const filters = new URLSearchParams();
  if (domain) filters.set("domain", domain);
  if (category) filters.set("category", category);
  if (topic) filters.set("tag", topic);
  filters.set("view", "classification");
  const classificationHref = `/graph?${filters}`;
  const focusQuery = focusTerm ? `&focus=${encodeURIComponent(focusTerm.slug)}` : "";
  const semanticHref = `/graph?view=semantic${focusQuery}`;
  const semanticManageHref = `/graph?view=semantic&panel=manage${focusQuery}`;
  const number = new Intl.NumberFormat("ko-KR");
  const graphTopBar = (
    <div className="graph-toolbar-shell sticky top-0 z-30 flex min-h-12 items-center gap-3 border-b border-line bg-panel px-4 py-2">
      <nav className="flex shrink-0 gap-1.5" aria-label="관계도 보기">
        <Link href={semanticHref} aria-current={semantic && semanticPanel === "explore" ? "page" : undefined} className={semantic && semanticPanel === "explore" ? "graph-toolbar-view-link btn-primary h-8 px-2.5 text-xs" : "graph-toolbar-view-link btn-ghost h-8 px-2.5 text-xs"}>의미 관계 탐색</Link>
        <Link href={semanticManageHref} aria-current={semantic && semanticPanel === "manage" ? "page" : undefined} className={semantic && semanticPanel === "manage" ? "graph-toolbar-view-link btn-primary h-8 px-2.5 text-xs" : "graph-toolbar-view-link btn-ghost h-8 px-2.5 text-xs"}>의미 관계 관리{(overview?.proposed ?? 0) > 0 ? ` · ${number.format(overview!.proposed)}` : ""}</Link>
        <Link href={classificationHref} aria-current={!semantic ? "page" : undefined} className={!semantic ? "graph-toolbar-view-link btn-primary h-8 px-2.5 text-xs" : "graph-toolbar-view-link btn-ghost h-8 px-2.5 text-xs"}>분류 관계</Link>
      </nav>
      <span
        className="graph-toolbar-count ml-auto max-w-52 truncate text-[11px] text-ink-3"
        title={semantic
          ? semanticPanel === "manage" ? `사용 가능한 승인 관계 ${number.format(overview?.total ?? 0)}개` : `사용 가능한 승인 관계 ${number.format(overview?.total ?? 0)}개 중 ${number.format(relations.length)}개 표시${!focusTerm && (overview?.omitted ?? 0) > 0 ? ` · ${number.format(overview!.omitted)}개 생략` : ""}`
          : `전체 ${number.format(classification?.total ?? 0)}개 중 ${number.format(classification?.items.length ?? 0)}개 표시`}
      >
        {semantic ? semanticPanel === "manage" ? `승인 관계 ${number.format(overview?.total ?? 0)}개` : `승인 관계 ${number.format(relations.length)}개 표시` : `${number.format(classification?.items.length ?? 0)} / ${number.format(classification?.total ?? 0)}개`}
      </span>
      {!semantic && <GraphFilterBar
        values={{ domain: domain ?? "", category: category ?? "", topic: topic ?? "" }}
        domains={facets.domains.map((f) => ({ value: f.value, label: f.value }))}
        categories={facets.categories.map((f) => ({ value: f.value, label: f.label }))}
        topics={facets.topics.map((f) => ({ value: f.value, label: f.value }))}
      />}
    </div>
  );

  return (
    <AppShell user={user} title="용어 관계도" current="graph" wide>
      <div className="min-h-0 flex-1 overflow-auto">
        {graphTopBar}
        {semantic && overview ? <SemanticGraphWorkspace
          panel={semanticPanel}
          terms={semanticTerms}
          relations={relations}
          overview={{ totalTerms: facets.total, usable: overview.total, proposed: overview.proposed, stale: overview.stale, omitted: overview.omitted }}
          focusTerm={focusTerm}
          invalidFocus={Boolean(focusSlug && !focusTerm)}
          paths={paths}
          domainColors={domainOptions.map(({ label, color }) => ({ label, color }))}
        /> : <TermGraph terms={classification?.items ?? []} domainColors={domainOptions.map(({ label, color }) => ({ label, color }))} />}
      </div>
    </AppShell>
  );
}
