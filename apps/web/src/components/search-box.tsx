"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { StatusBadge } from "@/components/term-badges";
import { SURFACE_KIND_LABEL } from "@/lib/terms/enums";
import {
  groupSuggestions,
  matchedPrefixLength,
  moveActive,
  termHref,
  type Suggestion,
} from "@/lib/terms/search-ui";
import { cx, displayName } from "@/lib/ui/format";

// 사람이 한 글자 치고 다음 글자를 치기까지의 간격보다 조금 길게. 이보다 짧으면
// "System"을 치는 동안 요청이 여섯 번 나가고, 이보다 길면 다 치고 기다리는
// 느낌이 든다.
const DEBOUNCE_MS = 140;

/**
 * R136: 모든 화면에서 쓰는 검색창. 자바스크립트 없이도 동작해야 하므로 **여전히 평범한 GET
 * 폼**이다 — 자동완성은 그 위에 얹은 것뿐이고, 후보를 고르지 않고 Enter를
 * 치면 예전처럼 `/?q=`로 제출된다(결과가 주소에 남아 공유·뒤로가기가 된다).
 */
export function SearchBox({
  defaultValue,
  compact = false,
  autoFocus = false,
}: {
  defaultValue: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  // Escape로 닫은 상태. 응답이 늦게 도착해서 목록이 저 혼자 다시 열리는 것을
  // 막는다 — 닫으려고 누른 키가 무시된 것처럼 보이는 게 이 UI에서 가장 흔한
  // 불쾌감이다.
  const [dismissed, setDismissed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // 응답 도착 순서는 요청 순서와 다르다. 늦게 온 옛 응답이 새 응답을 덮으면
  // 목록이 방금 지운 글자에 맞춰 되돌아간다 — 순번이 최신일 때만 반영한다.
  const seqRef = useRef(0);

  useEffect(() => {
    if (!compact) return;

    function focusSearch(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    }

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, [compact]);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      abortRef.current?.abort();
      setItems([]);
      setActive(-1);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = (seqRef.current += 1);

      try {
        const res = await fetch(`/api/v1/terms/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const body = res.ok ? ((await res.json()) as { items?: Suggestion[] }) : null;
        if (seq !== seqRef.current) return;
        setItems(body?.items ?? []);
        setActive(-1);
      } catch {
        // 취소(AbortError)와 네트워크 오류를 구분해 봐야 화면에서 할 일이 같다
        // — 자동완성은 부가 기능이므로 조용히 접는다. 검색 자체는 폼 제출로
        // 계속 동작한다.
        if (seq === seqRef.current) setItems([]);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  const { completions, similar } = groupSuggestions(items);
  // 키보드 이동과 화면 순서를 같은 배열 하나로 맞춘다. 두 묶음을 각각 그리면서
  // 인덱스만 따로 세면 어긋나기 쉽다.
  const ordered = [...completions, ...similar];
  const open = focused && !dismissed && ordered.length > 0;

  function go(item: Suggestion) {
    setDismissed(true);
    router.push(termHref(item));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중의 Enter는 글자를 확정하는 키다. 이걸 후보 선택으로 받으면
    // "시스템"을 치다가 엉뚱한 용어로 이동해 버린다(이 사전의 주 입력이 한글이다).
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Escape") {
      setDismissed(true);
      setActive(-1);
      return;
    }
    if (e.key === "ArrowDown" && dismissed) {
      e.preventDefault();
      setDismissed(false);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(moveActive(active, e.key === "ArrowDown" ? 1 : -1, ordered.length));
      return;
    }
    if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      go(ordered[active]!);
    }
  }

  return (
    <form method="get" action="/" role="search" className="w-full">
      <label htmlFor={inputId} className="sr-only">
        용어 검색
      </label>
      <div className="relative">
        <span className={cx(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-3",
          compact ? "left-3" : "left-4",
        )}>
          <IconSearch />
        </span>
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-keyshortcuts={compact ? "/" : undefined}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="용어 · 약어 · 별칭 · 금지 표기…"
          className={cx(
            "field border-line-strong bg-panel hover:border-brand/35",
            compact
              ? "h-10 rounded-xl pl-10 pr-11 text-sm shadow-sm"
              : "h-16 rounded-full pl-12 pr-5 text-base shadow-[0_10px_32px_-18px_rgb(38_32_99_/_0.42)]",
          )}
        />
        {compact && (
          <span className="kbd pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex" aria-hidden>
            /
          </span>
        )}

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="검색어 후보"
            // 이 한 줄이 목록을 실제로 누를 수 있게 만든다. mousedown의 기본
            // 동작은 입력창의 포커스를 빼앗는 것이고, 그러면 onBlur가 목록을
            // 지운 뒤에야 click이 도착해서 **아무 일도 일어나지 않는다**(R133과
            // 같은 계열의 조용한 실패). 눌러도 포커스가 입력창에 남게 막는다.
            onMouseDown={(e) => e.preventDefault()}
            className="card absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto py-1.5 shadow-lg"
          >
            {completions.length > 0 && <GroupLabel>자동완성</GroupLabel>}
            {completions.map((item, i) => (
              <Option
                key={item.id}
                id={`${listId}-${i}`}
                item={item}
                typed={value}
                selected={active === i}
                onHover={() => setActive(i)}
                onPick={() => go(item)}
              />
            ))}
            {similar.length > 0 && <GroupLabel>비슷한 표기</GroupLabel>}
            {similar.map((item, i) => (
              <Option
                key={item.id}
                id={`${listId}-${completions.length + i}`}
                item={item}
                typed={value}
                selected={active === completions.length + i}
                onHover={() => setActive(completions.length + i)}
                onPick={() => go(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {!compact && <div className="mt-4 flex items-center justify-center gap-2 px-1">
        <button type="submit" className="btn-ghost px-4 py-2 text-xs">
          검색
        </button>
        {/* 같은 입력을 시트의 q 필터로 그대로 넘긴다. formAction은 이 버튼으로
            제출할 때만 action을 바꾸므로 입력값을 두 번 적을 필요가 없다. */}
        <button type="submit" formAction="/sheet" className="btn-quiet btn-sm">
          시트에서 보기
        </button>
      </div>}
    </form>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  // role="presentation": 묶음 제목은 고를 수 있는 항목이 아니다. 이걸 빼면
  // 스크린리더가 "8개 중 3번째 항목"처럼 제목까지 세어 읽는다.
  return (
    <li role="presentation" className="px-3.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-3">
      {children}
    </li>
  );
}

function Option({
  id,
  item,
  typed,
  selected,
  onHover,
  onPick,
}: {
  id: string;
  item: Suggestion;
  typed: string;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const cut = matchedPrefixLength(item.matchedText, typed);
  const concept = displayName(item);

  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cx(
        "flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm",
        selected && "bg-panel-2",
      )}
    >
      <span className="shrink-0 truncate text-ink">
        <span className="font-semibold">{item.matchedText.slice(0, cut)}</span>
        {item.matchedText.slice(cut)}
      </span>
      {/* canonical은 표준명 자체라 배지가 동어반복이 된다. */}
      {item.matchedKind !== "canonical" && (
        <span className="chip shrink-0 px-1.5 py-0 text-[10px]">{SURFACE_KIND_LABEL[item.matchedKind]}</span>
      )}
      {concept !== item.matchedText && <span className="truncate text-xs text-ink-3">{concept}</span>}
      {/* 보완 필요 용어는 숨기지 않고 상태 배지로 현재 정리 수준을 알린다. */}
      {item.status !== "active" && <StatusBadge status={item.status} className="ml-auto shrink-0 text-[10px]" />}
    </li>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.25 3.25" strokeLinecap="round" />
    </svg>
  );
}
