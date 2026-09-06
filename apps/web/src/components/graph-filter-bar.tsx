"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type FilterName = "domain" | "category" | "topic";
type FilterValues = Record<FilterName, string>;
type FilterOption = { value: string; label: string };

export function graphFilterHref(pathname: string, values: FilterValues): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value) params.set(name, value);
  }
  return params.size ? `${pathname}?${params}` : pathname;
}

export function GraphFilterBar({
  values,
  domains,
  categories,
  topics,
}: {
  values: FilterValues;
  domains: FilterOption[];
  categories: FilterOption[];
  topics: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState(values);
  const [pending, startTransition] = useTransition();

  useEffect(() => setSelected(values), [values]);

  function navigate(next: FilterValues) {
    startTransition(() => router.push(graphFilterHref(pathname, next)));
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

  return (
    <div className="flex w-full flex-wrap items-end gap-2 lg:w-auto" aria-label="관계도 필터" aria-busy={pending}>
      <FilterSelect name="domain" value={selected.domain} label="도메인" emptyLabel="전체" options={domains} onChange={change} />
      <FilterSelect name="category" value={selected.category} label="업무 분류" emptyLabel="전체" options={categories} onChange={change} />
      <FilterSelect name="topic" value={selected.topic} label="주제" emptyLabel="전체" options={topics} onChange={change} />
      <button className="btn-ghost h-9 px-3 text-xs" type="button" onClick={reset} disabled={!Object.values(selected).some(Boolean) || pending}>
        초기화
      </button>
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
}: {
  name: FilterName;
  value: string;
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  onChange: (name: FilterName, value: string) => void;
}) {
  const id = `graph-filter-${name}`;
  return (
    <label htmlFor={id} className="min-w-[8.5rem] flex-1 text-[11px] font-medium text-ink-3 sm:flex-none">
      <span className="mb-1 block">{label}</span>
      <select
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        className="field h-9 min-w-[8.5rem] py-0 text-xs"
        onChange={(event) => onChange(name, event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
