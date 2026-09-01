import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TermGraph } from "@/components/term-graph";
import { getCurrentUser } from "@/lib/auth/current-user";
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
  const facets = await termFacets();
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
            <p className="mt-1 text-xs text-ink-3 lg:mt-0">같은 도메인, 업무 분류와 주제에 속한 용어를 맥락으로 연결합니다.</p>
          </div>
          <form method="get" className="flex flex-wrap gap-1.5">
            <Select name="domain" value={domain} label="도메인 전체" options={facets.domains.map((f) => ({ value: f.value, label: f.value }))} />
            <Select name="category" value={category} label="업무 분류 전체" options={facets.categories.map((f) => ({ value: f.value, label: f.label }))} />
            <Select name="topic" value={topic} label="주제 전체" options={facets.topics.map((f) => ({ value: f.value, label: f.value }))} />
            <button className="btn-ghost btn-sm" type="submit">적용</button>
          </form>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <p className="mb-3 text-xs text-ink-3">{terms.length}개 용어 · 허브는 최대 18개, 용어는 최대 100개를 표시합니다.</p>
        <TermGraph terms={terms} />
      </div>
    </AppShell>
  );
}

function Select({ name, value, label, options }: { name: string; value?: string; label: string; options: Array<{ value: string; label: string }> }) {
  return <select name={name} defaultValue={value ?? ""} aria-label={label} className="field h-8 w-auto py-0 text-xs"><option value="">{label}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
