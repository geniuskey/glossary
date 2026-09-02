"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FilterName } from "@/lib/terms/list-params";
import { cx } from "@/lib/ui/format";

export type SheetFilter = {
  name: Exclude<FilterName, "q">;
  label: string;
  value?: string;
  valueLabel?: string;
  options: Array<{ value: string; label: string; count: number }>;
};

export function SheetFilterBar({ query, filters }: { query: string; filters: SheetFilter[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query);
  const hasFilters = filters.some((filter) => filter.value);

  useEffect(() => setSearch(query), [query]);

  function navigate(change: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    change(params);
    params.delete("page");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate((params) => {
      const value = search.trim();
      if (value) params.set("q", value);
      else params.delete("q");
    });
  }

  return (
    <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 sm:basis-auto xl:flex-nowrap">
      <form onSubmit={submitSearch} className="relative w-full shrink-0 sm:w-64 lg:w-72">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-ink-3">
          <SearchIcon />
        </span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="용어 검색"
          placeholder="용어 · 약어 · 별칭 검색…"
          className="field h-9 py-0 pl-9 pr-9"
        />
        {(search || query) && (
          <button
            type="button"
            aria-label="검색어 지우기"
            className="absolute inset-y-0 right-1.5 my-auto grid h-6 w-6 place-items-center rounded-md text-ink-3 hover:bg-panel-2 hover:text-ink"
            onClick={() => {
              setSearch("");
              if (query) navigate((params) => params.delete("q"));
            }}
          >
            ×
          </button>
        )}
      </form>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <FilterMenu
            key={filter.name}
            filter={filter}
            onChange={(value) => navigate((params) => {
              if (value) params.set(filter.name, value);
              else params.delete(filter.name);
            })}
          />
        ))}

        {hasFilters && (
          <button
            type="button"
            className="btn-quiet btn-sm h-8 text-ink-3"
            onClick={() => navigate((params) => filters.forEach((filter) => params.delete(filter.name)))}
          >
            필터 초기화
          </button>
        )}
      </div>
    </div>
  );
}

function FilterMenu({ filter, onChange }: { filter: SheetFilter; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const active = Boolean(filter.value);
  const visibleOptions = search
    ? filter.options.filter((option) => option.label.toLocaleLowerCase("ko-KR").includes(search.toLocaleLowerCase("ko-KR")))
    : filter.options;

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choose(value: string) {
    onChange(value);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={rootRef} className="relative">
      <div className={cx(
        "flex h-8 items-stretch overflow-hidden rounded-lg border shadow-sm transition-[background-color,border-color,box-shadow]",
        active ? "border-brand/45 bg-brand-soft text-brand" : "border-line-strong bg-panel-2 text-ink-2 hover:border-brand/40 hover:bg-panel",
      )}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 px-2.5 text-xs font-medium"
          onClick={() => setOpen((value) => !value)}
        >
          <FilterIcon />
          {active ? (
            <span className="flex min-w-0 items-baseline gap-1">
              <span className="opacity-70">{filter.label}</span>
              <span className="max-w-36 truncate font-semibold">{filter.valueLabel}</span>
            </span>
          ) : (
            <span>{filter.label}</span>
          )}
          <ChevronIcon open={open} />
        </button>
        {active && (
          <button
            type="button"
            aria-label={`${filter.label} 필터 지우기`}
            className="grid w-7 place-items-center border-l border-brand/20 text-sm opacity-70 hover:bg-brand/10 hover:opacity-100"
            onClick={() => choose("")}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div role="dialog" aria-label={`${filter.label} 필터`} className="absolute left-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-panel p-1.5 shadow-pop">
          {filter.options.length > 8 && (
            <div className="relative mb-1.5">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-ink-3"><SearchIcon /></span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field h-8 py-0 pl-8 text-xs"
                placeholder={`${filter.label} 검색…`}
                aria-label={`${filter.label} 선택지 검색`}
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto overscroll-contain">
            <OptionButton label="전체" selected={!filter.value} onClick={() => choose("")} />
            {visibleOptions.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                count={option.count}
                selected={filter.value === option.value}
                onClick={() => choose(option.value)}
              />
            ))}
            {visibleOptions.length === 0 && <p className="px-3 py-6 text-center text-xs text-ink-3">일치하는 항목이 없습니다.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function OptionButton({ label, count, selected, onClick }: { label: string; count?: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-panel-2",
        selected && "bg-brand-soft font-medium text-brand",
      )}
      onClick={onClick}
    >
      <span className="grid w-4 shrink-0 place-items-center" aria-hidden>{selected ? "✓" : ""}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-mono tabular-nums text-ink-3">{count.toLocaleString("ko-KR")}</span>}
    </button>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="8.5" cy="8.5" r="4.75" /><path d="m12 12 4 4" /></svg>;
}

function FilterIcon() {
  return <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 5h14M5.5 10h9M8 15h4" /></svg>;
}

function ChevronIcon({ open }: { open: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 8 4 4 4-4" /></svg>;
}
