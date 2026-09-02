"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HelpTip } from "@/components/help-tip";
import { cx } from "@/lib/ui/format";

export interface ClassificationOption {
  value: string;
  label: string;
  secondaryLabel?: string;
}

interface RefreshConfig {
  url: string;
  responseKey: "domains" | "categories";
}

export function ClassificationMultiSelect({
  name,
  label,
  help,
  placeholder,
  selected,
  initialOptions,
  kind,
  manageHref,
  refresh,
  disabled = false,
  invalid = false,
  describedBy,
  onChange,
}: {
  name: string;
  label: string;
  help: string;
  placeholder: string;
  selected: string[];
  initialOptions: ClassificationOption[];
  kind: "domain" | "category";
  manageHref: string;
  refresh: RefreshConfig;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (values: string[]) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastRefreshRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [options, setOptions] = useState(initialOptions);
  const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, width: 320 });

  useEffect(() => setMounted(true), []);
  useEffect(() => setOptions(initialOptions), [initialOptions]);

  const refreshOptions = useCallback(async () => {
    if (Date.now() - lastRefreshRef.current < 1_000) return;
    lastRefreshRef.current = Date.now();
    try {
      const response = await fetch(refresh.url, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as Record<string, Array<Record<string, unknown>>>;
      const rows = body[refresh.responseKey] ?? [];
      setOptions(rows.flatMap((row) => {
        if (kind === "domain" && typeof row.label === "string") {
          return [{ value: row.label, label: row.label }];
        }
        if (kind === "category" && typeof row.key === "string" && typeof row.label === "string") {
          return [{
            value: row.key,
            label: row.label,
            secondaryLabel: typeof row.labelEn === "string" ? row.labelEn : undefined,
          }];
        }
        return [];
      }));
    } catch {
      // 분류 추가 후 자동 갱신은 보조 기능이다. 네트워크 오류가 폼 입력을 막지 않는다.
    }
  }, [kind, refresh.responseKey, refresh.url]);

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 8;
    const width = Math.max(280, rect.width);
    const left = Math.min(rect.left, window.innerWidth - width - gutter);
    setMenuStyle({ left: Math.max(gutter, left), top: rect.bottom + 6, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const reposition = () => updateMenuPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    const onWindowFocus = () => void refreshOptions();
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [refreshOptions]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => options.filter((option) => {
    if (selectedSet.has(option.value)) return false;
    if (!normalizedQuery) return true;
    return [option.label, option.secondaryLabel, option.value]
      .some((value) => value?.toLocaleLowerCase("ko").includes(normalizedQuery));
  }), [normalizedQuery, options, selectedSet]);
  const hasExactMatch = options.some((option) => [option.label, option.secondaryLabel, option.value]
    .some((value) => value?.toLocaleLowerCase("ko") === normalizedQuery));

  useEffect(() => setActiveIndex(-1), [normalizedQuery]);

  function choose(value: string) {
    if (!selectedSet.has(value)) onChange([...selected, value]);
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function remove(value: string) {
    onChange(selected.filter((item) => item !== value));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].value);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && !query && selected.length > 0) {
      remove(selected[selected.length - 1]!);
    }
  }

  const selectedOptions = selected.map((value) => options.find((option) => option.value === value)
    ?? { value, label: value });
  const addHref = `${manageHref}${manageHref.includes("?") ? "&" : "?"}new=${encodeURIComponent(query.trim())}`;

  const menu = open && mounted ? createPortal(
    <div
      ref={menuRef}
      id={listId}
      role="listbox"
      aria-label={`${label} 선택지`}
      aria-multiselectable="true"
      className="fixed z-[100] max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl"
      style={menuStyle}
    >
      {filtered.length > 0 ? filtered.map((option, index) => (
        <button
          key={option.value}
          id={`${listId}-option-${index}`}
          type="button"
          role="option"
          aria-selected="false"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(option.value)}
          className={cx(
            "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-brand",
            index === activeIndex && "bg-panel-2",
          )}
        >
          <span className="min-w-0 truncate font-medium">{option.label}</span>
          {option.secondaryLabel && <span className="shrink-0 text-xs text-ink-3">{option.secondaryLabel}</span>}
        </button>
      )) : (
        <p className="px-2.5 py-2 text-sm text-ink-3">일치하는 분류가 없습니다.</p>
      )}
      {query.trim() && !hasExactMatch && (
        <Link
          href={addHref}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(event) => event.preventDefault()}
          className="mt-1 flex w-full items-center justify-between rounded-lg border-t border-line px-2.5 py-2.5 text-sm font-medium text-brand hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="min-w-0 truncate">‘{query.trim()}’ 분류 체계에서 추가</span>
          <span aria-hidden="true">↗</span>
        </Link>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="block min-w-0">
      <span className="label inline-flex items-center gap-1.5">
        <label htmlFor={`${name}-search`}>{label}</label>
        <HelpTip text={help} />
      </span>
      <div
        ref={rootRef}
        className={cx(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-2 py-1.5 shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20",
          invalid && "border-danger",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {selectedOptions.map((option) => (
          <span
            key={option.value}
            className={cx(
              "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
              kind === "domain"
                ? "border-info/30 bg-info-soft text-info"
                : "border-brand/30 bg-brand-soft text-brand",
            )}
            title={option.secondaryLabel ? `${option.label} · ${option.secondaryLabel}` : option.label}
          >
            <span className="truncate">{option.label}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => { event.stopPropagation(); remove(option.value); }}
              className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-current"
              aria-label={`${option.label} 제거`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={`${name}-search`}
          name={`${name}Search`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
          value={query}
          onFocus={() => { setOpen(true); updateMenuPosition(); void refreshOptions(); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : "검색…"}
          className="min-w-[9rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {menu}
    </div>
  );
}
