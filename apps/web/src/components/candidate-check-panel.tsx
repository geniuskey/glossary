"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface CandidateView {
  id: string;
  text: string;
  status: "open" | "dismissed" | "promoted";
  occurrenceCount: number;
  sampleContext: string | null;
  source: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lexiconVersion: string | null;
  promotedTermId: string | null;
  decisionNote: string | null;
}

interface ValidationFinding {
  rule: string;
  severity: "error" | "warning" | "info";
  matchedText: string;
  message: string;
  span: { start: number; end: number; line: number; col: number; endLine: number; endCol: number };
}

interface ValidationHighlight {
  kind: "registered" | "unregistered";
  matchedText: string;
  span: { start: number; end: number };
  termId?: string;
  slug?: string;
  surfaceKind?: string;
}

interface ValidationResult {
  stats: { matched: number; errors: number; warnings: number; unregistered: number };
  findings: ValidationFinding[];
  highlights?: ValidationHighlight[];
  highlightsTruncated?: boolean;
}

type CheckView = "check" | "candidates";
type DisplayKind = "error" | "warning" | "unregistered" | "registered";
type ResultFilter = "all" | DisplayKind;
interface DisplayHighlight extends ValidationHighlight {
  displayKind: DisplayKind;
  message?: string;
}
interface ResultGroup {
  key: string;
  kind: DisplayKind;
  text: string;
  message?: string;
  spans: Array<{ start: number; end: number }>;
}

const KIND_LABEL: Record<DisplayKind, string> = {
  error: "오류",
  warning: "주의",
  unregistered: "후보",
  registered: "등록",
};
const FILTERS: Array<{ value: ResultFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "error", label: "오류" },
  { value: "warning", label: "주의" },
  { value: "unregistered", label: "후보" },
  { value: "registered", label: "등록" },
];

export function CandidateCheckPanel({
  initialCandidates,
  total,
  page,
  pageSize,
  query,
  initialView,
}: {
  initialCandidates: CandidateView[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  initialView: CheckView;
}) {
  const router = useRouter();
  const [view, setView] = useState<CheckView>(initialView);
  const [content, setContent] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [resultQuery, setResultQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);
  const [showAllTerms, setShowAllTerms] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const highlights = useMemo(() => result ? buildHighlights(content, result) : [], [content, result]);
  const groups = useMemo(() => buildGroups(highlights), [highlights]);
  const lineStarts = useMemo(() => result ? getLineStarts(content) : [0], [content, result]);
  const unregisteredTerms = groups.filter((group) => group.kind === "unregistered").map((group) => group.text);
  const unregisteredText = unregisteredTerms.join(", ");
  const filteredGroups = groups.filter((group) =>
    (resultFilter === "all" || group.kind === resultFilter)
    && group.text.toLocaleLowerCase().includes(resultQuery.trim().toLocaleLowerCase()),
  );
  const shownGroups = filteredGroups.slice(0, visibleCount);

  useEffect(() => {
    const onPopState = () => setView(new URL(window.location.href).searchParams.get("view") === "candidates" ? "candidates" : "check");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (view === "check" && selectedKey) document.getElementById(resultItemId(selectedKey))?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, resultFilter, view, visibleCount]);

  function switchView(next: CheckView) {
    if (next === view) return;
    const url = new URL(window.location.href);
    if (next === "candidates") url.searchParams.set("view", "candidates");
    else url.searchParams.delete("view");
    window.history.pushState(null, "", url);
    setError(null);
    setView(next);
  }

  function selectHighlight(highlight: DisplayHighlight) {
    const key = groupKey(highlight.displayKind, highlight.matchedText);
    setSelectedKey(key);
    setSelectedStart(highlight.span.start);
    setResultFilter("all");
    setResultQuery("");
    setVisibleCount(Math.max(100, groups.findIndex((group) => group.key === key) + 1));
  }

  function jumpToGroup(group: ResultGroup) {
    const currentIndex = group.spans.findIndex((span) => span.start === selectedStart);
    const next = group.spans[selectedKey === group.key ? (currentIndex + 1) % group.spans.length : 0];
    if (!next) return;
    setSelectedKey(group.key);
    setSelectedStart(next.start);
    const mark = document.getElementById(markId(next.start, next.end));
    mark?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    mark?.focus({ preventScroll: true });
  }

  async function copyTerms() {
    try {
      await navigator.clipboard.writeText(unregisteredText);
      setCopyStatus("복사했습니다.");
    } catch {
      setCopyStatus("복사하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  async function checkDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setError("점검할 문서를 입력해 주세요.");
      document.getElementById("document-content")?.focus();
      return;
    }
    setChecking(true);
    setError(null);
    setCopyStatus("");
    try {
      const response = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, format: "markdown", options: { collectCandidates: true } }),
      });
      const body = await response.json().catch(() => null) as ValidationResult & { error?: { message?: string } } | null;
      if (!response.ok || !body?.findings || !body?.stats) throw new Error(body?.error?.message ?? "문서를 점검하지 못했습니다. 다시 시도해 주세요.");
      setResult(body);
      setResultFilter("all");
      setResultQuery("");
      setVisibleCount(100);
      setSelectedKey(null);
      setSelectedStart(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문서를 점검하지 못했습니다.");
    } finally {
      setChecking(false);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/candidates/${id}/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "후보를 무시하지 못했습니다.");
      }
      router.refresh();
      setActiveId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후보를 무시하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function promote(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nameEn = String(form.get("nameEn") ?? "").trim();
    const nameKo = String(form.get("nameKo") ?? "").trim();
    if (!nameEn && !nameKo) {
      setError("영문명 또는 국문명을 하나 이상 입력해 주세요.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/candidates/${id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(nameEn ? { nameEn } : {}),
          ...(nameKo ? { nameKo } : {}),
          definitionMd: String(form.get("definitionMd") ?? "").trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "후보를 용어로 등록하지 못했습니다.");
      setActiveId(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후보를 용어로 등록하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
        <div className="flex gap-1" aria-label="문서 점검 보기">
          <button type="button" onClick={() => switchView("check")} aria-current={view === "check" ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${view === "check" ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-panel-2"}`}>점검</button>
          <button type="button" onClick={() => switchView("candidates")} aria-current={view === "candidates" ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${view === "candidates" ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-panel-2"}`}>후보 관리 <span className="ml-1 text-xs">{total}</span></button>
        </div>
        <Link href="/api" className="link shrink-0 text-xs">API 자동화</Link>
      </div>

      {view === "check" ? (
        <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-stretch">
          <form className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-3 shadow-sm xl:h-[calc(100dvh-8.5rem)] xl:min-h-[36rem]" onSubmit={checkDocument}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {result ? <span className="text-sm font-semibold text-ink">문서 본문</span> : <label htmlFor="document-content" className="text-sm font-semibold text-ink">문서 본문</label>}
              <div className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-ink-3">{content.length.toLocaleString("ko-KR")} / 1,000,000자</span>
                {result && <button type="button" className="btn-quiet h-8 px-2.5 text-xs" onClick={() => { setResult(null); setSelectedKey(null); setSelectedStart(null); requestAnimationFrame(() => document.getElementById("document-content")?.focus()); }}>본문 수정</button>}
              </div>
            </div>
            {result ? (
              <pre id="document-content" tabIndex={0} aria-label="점검된 문서 본문" className="field min-h-[30rem] min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words border-line-strong bg-panel-2 font-mono text-sm leading-7 text-ink xl:min-h-0">
                <HighlightedDocument content={content} highlights={highlights} selectedStart={selectedStart} onSelect={selectHighlight} />
              </pre>
            ) : (
              <textarea id="document-content" name="content" value={content} onChange={(event) => setContent(event.target.value)} disabled={checking} aria-describedby={error ? "check-error" : undefined} className="field min-h-[30rem] min-w-0 flex-1 resize-y border-line-strong bg-panel-2 font-mono text-sm leading-7 shadow-sm xl:min-h-0" placeholder="# 문서 제목\n\n본문을 붙여 넣으세요…" maxLength={1_000_000} />
            )}
            {error && <p id="check-error" role="alert" className="mt-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            {!result && <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-ink-3">한국어 문장 속 영문 표기와 명시적인 용어 표현을 찾습니다.</span>
              <button type="submit" className="btn-primary shrink-0" disabled={checking}>{checking ? "점검 중…" : "문서 점검"}</button>
            </div>}
          </form>

          <aside aria-label="문서 점검 결과" className={`flex min-h-[20rem] min-w-0 flex-col rounded-xl border border-line bg-panel p-3 shadow-sm xl:h-[calc(100dvh-8.5rem)] xl:min-h-[36rem] ${result ? "h-[min(65dvh,40rem)]" : ""}`}>
            {result ? (
              <>
                <h3 className="text-sm font-semibold text-ink">점검 결과</h3>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs tabular-nums text-ink-2" aria-live="polite">
                  <span className="rounded-md bg-panel-2 px-2 py-1">등록 매칭 {result.stats.matched}</span>
                  <span className="rounded-md bg-danger-soft px-2 py-1 text-danger">오류 {result.stats.errors}</span>
                  <span className="rounded-md bg-warn-soft px-2 py-1 text-warn">주의 {result.stats.warnings}</span>
                  <span className="rounded-md bg-warn-soft px-2 py-1 text-warn">미등록 후보 {result.stats.unregistered}</span>
                </div>
                <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-ink">미등록 후보 · {unregisteredTerms.length}개</h4>
                    {unregisteredTerms.length > 0 && <button type="button" className="link shrink-0 text-xs" onClick={copyTerms}>전체 복사</button>}
                  </div>
                  <p className={`mt-1.5 break-words text-xs leading-5 text-ink-2 ${showAllTerms ? "max-h-40 overflow-y-auto" : "max-h-[3.75rem] overflow-hidden"}`}>{unregisteredText || "미등록 후보가 발견되지 않았습니다."}</p>
                  {unregisteredText.length > 100 && <button type="button" className="link mt-1 text-xs" onClick={() => setShowAllTerms((value) => !value)} aria-expanded={showAllTerms}>{showAllTerms ? "접기" : "전체 보기"}</button>}
                  {copyStatus && <p role="status" className="mt-1 text-xs text-ink-3">{copyStatus}</p>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1" aria-label="결과 종류 필터">
                  {FILTERS.map((filter) => <button key={filter.value} type="button" aria-pressed={resultFilter === filter.value} onClick={() => { setResultFilter(filter.value); setVisibleCount(100); }} className={`rounded-md px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${resultFilter === filter.value ? "bg-brand text-brand-on" : "bg-panel-2 text-ink-2 hover:bg-brand-soft hover:text-brand"}`}>{filter.label}</button>)}
                </div>
                <label htmlFor="result-query" className="sr-only">결과 단어 검색</label>
                <input id="result-query" type="search" value={resultQuery} onChange={(event) => { setResultQuery(event.target.value); setVisibleCount(100); }} className="field mt-2 h-9 text-xs" placeholder="결과 단어 검색…" autoComplete="off" />
                <p className="my-2 text-xs tabular-nums text-ink-3">{filteredGroups.length.toLocaleString("ko-KR")}개 표기 · 선택하면 본문으로 이동</p>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line" aria-label="점검 결과 목록">
                  {shownGroups.length > 0 ? <ul className="divide-y divide-line">
                    {shownGroups.map((group) => <li key={group.key} id={resultItemId(group.key)}>
                      <button type="button" onClick={() => jumpToGroup(group)} aria-current={selectedKey === group.key ? "true" : undefined} className={`flex w-full min-w-0 items-start gap-2 px-1 py-2.5 text-left text-xs hover:bg-panel-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${selectedKey === group.key ? "bg-brand-soft/50" : ""}`}>
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-semibold ${kindBadgeClass(group.kind)}`}>{KIND_LABEL[group.kind]}</span>
                        <span className="min-w-0 flex-1 break-words"><strong className="font-medium text-ink">{group.text}</strong>{group.message && <span className="mt-0.5 block text-ink-3">{group.message}</span>}</span>
                        <span className="shrink-0 text-right tabular-nums text-ink-3">{linePosition(lineStarts, group.spans[0]!.start)}<span className="block">{group.spans.length}회</span></span>
                      </button>
                    </li>)}
                  </ul> : <p className="px-2 py-6 text-center text-xs text-ink-3">{groups.length === 0 ? "표시할 표기가 없습니다." : "검색 조건에 맞는 표기가 없습니다."}</p>}
                  {filteredGroups.length > visibleCount && <button type="button" className="btn-quiet my-2 w-full text-xs" onClick={() => setVisibleCount((count) => count + 100)}>100개 더 보기</button>}
                </div>
                {result.highlightsTruncated && <p className="mt-2 text-xs text-ink-3">강조 표기 5,000개 이후는 표시되지 않았습니다.</p>}
              </>
            ) : <div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-6 text-ink-3"><p>본문을 붙여 넣고 점검하면 결과가 여기에 표시됩니다.</p></div>}
          </aside>
        </section>
      ) : <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div><h3 className="text-base font-semibold text-ink">미등록 후보</h3><p className="mt-1 text-xs text-ink-3">발견 빈도가 높은 순서로 표시합니다. 현재 {total}개가 열려 있습니다.</p></div>
          <form className="flex gap-2" action="/check">
            <input type="hidden" name="view" value="candidates" />
            <label className="sr-only" htmlFor="candidate-query">후보 검색</label>
            <input id="candidate-query" name="q" defaultValue={query} className="field h-9 w-48 text-xs" placeholder="후보 검색…" autoComplete="off" />
            <button className="btn-quiet h-9 px-3 text-xs" type="submit">검색</button>
          </form>
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3 text-xs text-danger">{error}</p>}
        {initialCandidates.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-line px-5 py-10 text-center"><p className="text-sm text-ink-2">열린 후보가 없습니다.</p><p className="mt-1 text-xs text-ink-3">문서 점검에서 발견된 미등록 후보가 이곳에 쌓입니다.</p></div>
        ) : (
          <ul className="mt-4 space-y-3">
            {initialCandidates.map((candidate) => (
              <li key={candidate.id} className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-ink">{candidate.text}</h4><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">{candidate.occurrenceCount}회 발견</span></div>
                    <p className="mt-2 text-xs leading-5 text-ink-3">{candidate.sampleContext ?? "샘플 문맥 없음"}</p>
                    <p className="mt-2 text-[11px] text-ink-3">{candidate.source ? `${candidate.source} · ` : ""}최근 {formatDate(candidate.lastSeenAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="btn-primary h-9 px-3 text-xs" onClick={() => setActiveId(activeId === candidate.id ? null : candidate.id)} disabled={busyId === candidate.id}>{activeId === candidate.id ? "닫기" : "용어로 등록"}</button>
                    <button type="button" className="btn-quiet h-9 px-3 text-xs" onClick={() => dismiss(candidate.id)} disabled={busyId === candidate.id}>무시</button>
                  </div>
                </div>
                {activeId === candidate.id && <PromotionForm candidate={candidate} onSubmit={promote} busy={busyId === candidate.id} />}
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 && <div className="mt-5 flex items-center justify-center gap-3 text-xs"><span className="text-ink-3">{page} / {totalPages}</span>{page > 1 && <Link className="link" href={`/check?${new URLSearchParams({ ...(query ? { q: query } : {}), view: "candidates", page: String(page - 1) })}`}>이전</Link>}{page < totalPages && <Link className="link" href={`/check?${new URLSearchParams({ ...(query ? { q: query } : {}), view: "candidates", page: String(page + 1) })}`}>다음</Link>}</div>}
      </section>}
    </div>
  );
}

function groupKey(kind: DisplayKind, text: string) {
  return `${kind}:${text.toLocaleLowerCase()}`;
}

function markId(start: number, end: number) {
  return `check-mark-${start}-${end}`;
}

function resultItemId(key: string) {
  return `check-result-${encodeURIComponent(key)}`;
}

function getLineStarts(content: string) {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function linePosition(starts: number[], offset: number) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return `${low + 1}:${offset - starts[low]! + 1}`;
}

function priority(kind: DisplayKind) {
  return { error: 0, warning: 1, unregistered: 2, registered: 3 }[kind];
}

function buildHighlights(content: string, result: ValidationResult): DisplayHighlight[] {
  const bySpan = new Map<string, DisplayHighlight>();
  const add = (highlight: DisplayHighlight) => {
    const { start, end } = highlight.span;
    if (start < 0 || end <= start || end > content.length || content.slice(start, end) !== highlight.matchedText) return;
    const key = `${start}:${end}`;
    const previous = bySpan.get(key);
    if (!previous || priority(highlight.displayKind) < priority(previous.displayKind)) bySpan.set(key, highlight);
  };

  for (const highlight of result.highlights ?? []) add({ ...highlight, displayKind: highlight.kind });

  for (const finding of result.findings) {
    const displayKind: DisplayKind = finding.rule === "unregistered" ? "unregistered" : finding.severity === "error" ? "error" : "warning";
    const matching = bySpan.get(`${finding.span.start}:${finding.span.end}`);
    if (matching) {
      bySpan.set(`${finding.span.start}:${finding.span.end}`, { ...matching, displayKind, message: finding.message });
      continue;
    }
    if (result.highlights?.length) {
      add({ kind: displayKind === "unregistered" ? "unregistered" : "registered", matchedText: finding.matchedText, span: finding.span, displayKind, message: finding.message });
      continue;
    }
    // Older API responses have findings but no per-occurrence highlights.
    if (!finding.matchedText) continue;
    let start = content.indexOf(finding.matchedText);
    while (start !== -1) {
      add({ kind: displayKind === "unregistered" ? "unregistered" : "registered", matchedText: finding.matchedText, span: { start, end: start + finding.matchedText.length }, displayKind, message: finding.message });
      start = content.indexOf(finding.matchedText, start + finding.matchedText.length);
    }
  }

  const ordered = [...bySpan.values()].sort((a, b) => a.span.start - b.span.start || priority(a.displayKind) - priority(b.displayKind) || b.span.end - a.span.end);
  const visible: DisplayHighlight[] = [];
  let cursor = 0;
  for (const highlight of ordered) {
    if (highlight.span.start < cursor) continue;
    visible.push(highlight);
    cursor = highlight.span.end;
  }
  return visible;
}

function buildGroups(highlights: DisplayHighlight[]): ResultGroup[] {
  const byKey = new Map<string, ResultGroup>();
  for (const highlight of highlights) {
    const key = groupKey(highlight.displayKind, highlight.matchedText);
    const group = byKey.get(key);
    if (group) {
      group.spans.push(highlight.span);
      if (!group.message && highlight.message) group.message = highlight.message;
    } else {
      byKey.set(key, { key, kind: highlight.displayKind, text: highlight.matchedText, message: highlight.message, spans: [highlight.span] });
    }
  }
  return [...byKey.values()].sort((a, b) => priority(a.kind) - priority(b.kind) || a.spans[0]!.start - b.spans[0]!.start);
}

function kindBadgeClass(kind: DisplayKind) {
  if (kind === "error") return "bg-danger-soft text-danger";
  if (kind === "warning" || kind === "unregistered") return "bg-warn-soft text-warn";
  return "bg-brand-soft text-brand";
}

function markClass(kind: DisplayKind, selected: boolean) {
  const color = kind === "error"
    ? "border-danger bg-danger-soft text-danger"
    : kind === "warning"
      ? "border-warn bg-warn-soft text-warn"
      : kind === "unregistered"
        ? "border-warn bg-warn/25 text-ink"
        : "border-brand bg-brand/20 text-ink";
  return `inline rounded-sm border-b-2 px-0.5 font-mono font-semibold whitespace-pre-wrap hover:brightness-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${color} ${selected ? "ring-2 ring-brand ring-offset-1" : ""}`;
}

function HighlightedDocument({ content, highlights, selectedStart, onSelect }: {
  content: string;
  highlights: DisplayHighlight[];
  selectedStart: number | null;
  onSelect: (highlight: DisplayHighlight) => void;
}) {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const highlight of highlights) {
    const { start, end } = highlight.span;
    if (start > cursor) pieces.push(content.slice(cursor, start));
    pieces.push(<button key={markId(start, end)} id={markId(start, end)} type="button" onClick={() => onSelect(highlight)} aria-label={`${highlight.matchedText}, ${KIND_LABEL[highlight.displayKind]}, 결과에서 보기`} className={markClass(highlight.displayKind, selectedStart === start)}>{content.slice(start, end)}</button>);
    cursor = end;
  }
  if (cursor < content.length) pieces.push(content.slice(cursor));
  return <>{pieces}</>;
}

function PromotionForm({ candidate, onSubmit, busy }: { candidate: CandidateView; onSubmit: (event: FormEvent<HTMLFormElement>, id: string) => void; busy: boolean }) {
  const likelyEnglish = /^[\u0000-\u007f]+$/.test(candidate.text);
  return (
    <form onSubmit={(event) => onSubmit(event, candidate.id)} className="mt-4 border-t border-line pt-4">
      <p className="text-xs font-medium text-ink-2">용어 기본 정보</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-2">영문명<input name="nameEn" defaultValue={likelyEnglish ? candidate.text : ""} className="field mt-1.5 w-full" maxLength={200} /></label>
        <label className="text-xs text-ink-2">국문명<input name="nameKo" defaultValue={likelyEnglish ? "" : candidate.text} className="field mt-1.5 w-full" maxLength={200} /></label>
      </div>
      <label className="mt-3 block text-xs text-ink-2">한줄 정의 <span className="text-ink-3">(선택)</span><textarea name="definitionMd" className="field mt-1.5 min-h-20 w-full resize-y text-sm" placeholder="이 용어가 무엇을 뜻하는지 간단히 적어 주세요." maxLength={20_000} /></label>
      <div className="mt-3 flex justify-end"><button type="submit" className="btn-primary h-9 px-3 text-xs" disabled={busy}>{busy ? "등록 중…" : "초안으로 등록"}</button></div>
    </form>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
