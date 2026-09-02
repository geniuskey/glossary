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
    <div className="flex flex-wrap items-center gap-1.5" aria-label="관계도 필터" aria-busy={pending}>
      <FilterSelect name="domain" value={selected.domain} label="도메인 전체" options={domains} onChange={change} />
      <FilterSelect name="category" value={selected.category} label="업무 분류 전체" options={categories} onChange={change} />
      <FilterSelect name="topic" value={selected.topic} label="주제 전체" options={topics} onChange={change} />
      <button className="btn-ghost btn-sm" type="button" onClick={reset} disabled={!Object.values(selected).some(Boolean) || pending}>
        초기화
      </button>
    </div>
  );
}

function FilterSelect({
  name,
  value,
  label,
  options,
  onChange,
}: {
  name: FilterName;
  value: string;
  label: string;
  options: FilterOption[];
  onChange: (name: FilterName, value: string) => void;
}) {
  return (
    <select
      name={name}
      value={value}
      aria-label={label}
      className="field h-8 w-auto py-0 text-xs"
      onChange={(event) => onChange(name, event.target.value)}
    >
      <option value="">{label}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
