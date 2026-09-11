"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FilterName } from "@/lib/terms/list-params";

export type SheetFilter = {
  name: Exclude<FilterName, "q">;
  label: string;
  value?: string;
  valueLabel?: string;
  options: Array<{ value: string; label: string; count: number }>;
};

export function SheetFilterBar({ query }: { query: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setSearch(query), [query]);

  function navigate(change: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(window.location.search);
    change(params);
    params.delete("page");
    const next = params.toString();
    startTransition(() => router.push(next ? `${pathname}?${next}` : pathname));
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
    <form onSubmit={submitSearch} role="search" aria-label="시트 내 검색" aria-busy={pending} className="relative flex w-full min-w-0 shrink-0 basis-full gap-2 sm:w-80 sm:basis-auto lg:w-96">
      <div className="relative min-w-0 flex-1">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-ink-3">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          name="q"
          autoComplete="off"
          enterKeyHint="search"
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
              inputRef.current?.focus();
              if (query) navigate((params) => params.delete("q"));
            }}
          >
            ×
          </button>
        )}
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 shrink-0 px-3 text-xs">
        {pending ? "검색 중…" : "검색"}
      </button>
      <span className="sr-only" aria-live="polite">{pending ? "검색 결과를 불러오는 중…" : ""}</span>
    </form>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="8.5" cy="8.5" r="4.75" /><path d="m12 12 4 4" /></svg>;
}
