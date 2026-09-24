"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type FilterName = "domain" | "category" | "topic";
type FilterValues = Record<FilterName, string>;
type FilterOption = { value: string; label: string };

export function graphFilterHref(pathname: string, values: FilterValues, view?: "semantic"): string {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  for (const [name, value] of Object.entries(values)) {
    if (value) params.set(name === "topic" ? "tag" : name, value);
  }
  return params.size ? `${pathname}?${params}` : pathname;
}

export function GraphFilterBar({
  values,
  domains,
  categories,
  topics,
  view,
}: {
  values: FilterValues;
  domains: FilterOption[];
  categories: FilterOption[];
  topics: FilterOption[];
  view?: "semantic";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState(values);
  const [pending, startTransition] = useTransition();

  useEffect(() => setSelected(values), [values]);

  function navigate(next: FilterValues) {
    startTransition(() => router.push(graphFilterHref(pathname, next, view)));
  }

  function change(name: FilterName, value: string) {
    const next = { ...selected, [name]: value };
    setSelected(next);
    navigate(next);
  }

  function reset() {
    const next = { domain: "", category: "", topic: "" };
    setSelected(next);
    navigate(next);
  }

  const filterCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="relative flex shrink-0 items-center" aria-label="관계도 필터" aria-busy={pending}>
      <div className="graph-toolbar-filters-full w-max items-center gap-1.5">
        <FilterSelect name="domain" value={selected.domain} label="도메인" emptyLabel="전체" options={domains} onChange={change} />
        <FilterSelect name="category" value={selected.category} label="업무 분류" emptyLabel="전체" options={categories} onChange={change} />
        <FilterSelect name="topic" value={selected.topic} label="태그" emptyLabel="전체" options={topics} onChange={change} />
        <button className="btn-ghost h-8 shrink-0 px-2.5 text-xs" type="button" onClick={reset} disabled={!filterCount || pending}>
          초기화
        </button>
      </div>

      <details className="graph-toolbar-filters-compact relative">
        <summary className="graph-toolbar-filter-trigger btn-ghost h-8 list-none gap-1 px-2.5 text-xs">
          필터
          {filterCount > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-soft px-1 text-[10px] font-semibold text-brand">{filterCount}</span>}
        </summary>
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel p-3 shadow-lg">
          <div className="space-y-2">
            <FilterSelect idPrefix="compact" name="domain" value={selected.domain} label="도메인" emptyLabel="전체" options={domains} onChange={change} compact />
            <FilterSelect idPrefix="compact" name="category" value={selected.category} label="업무 분류" emptyLabel="전체" options={categories} onChange={change} compact />
            <FilterSelect idPrefix="compact" name="topic" value={selected.topic} label="태그" emptyLabel="전체" options={topics} onChange={change} compact />
          </div>
          <button className="btn-ghost mt-3 h-8 w-full px-2.5 text-xs" type="button" onClick={reset} disabled={!filterCount || pending}>
            필터 초기화
          </button>
        </div>
      </details>
      <span className="sr-only" aria-live="polite">{pending ? "필터를 적용하는 중…" : ""}</span>
    </div>
  );
}

function FilterSelect({
  name,
  value,
  label,
  emptyLabel,
  options,
  onChange,
  idPrefix,
  compact = false,
}: {
  name: FilterName;
  value: string;
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  onChange: (name: FilterName, value: string) => void;
  idPrefix?: string;
  compact?: boolean;
}) {
  const id = `graph-filter-${idPrefix ? `${idPrefix}-` : ""}${name}`;
  return (
    <label htmlFor={id} className={compact ? "flex min-w-0 items-center gap-2 text-xs font-medium text-ink-2" : "flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-3"}>
      <span className={compact ? "w-14 shrink-0" : "shrink-0"}>{label}</span>
      <select
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        className={compact ? "field h-8 min-w-0 flex-1 py-0 text-xs" : "field h-8 w-[7.25rem] py-0 text-xs sm:w-[7.75rem]"}
        onChange={(event) => onChange(name, event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
