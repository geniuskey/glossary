"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
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

export function CandidateCheckPanel({
  initialCandidates,
  total,
  page,
  pageSize,
  query,
}: {
  initialCandidates: CandidateView[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setError("점검할 문서를 입력해 주세요.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, format: "markdown", options: { collectCandidates: true } }),
      });
      const body = await response.json().catch(() => null) as ValidationResult & { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "문서를 점검하지 못했습니다.");
      setResult(body);
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

  const unregisteredTerms = result
    ? result.findings.filter((finding) => finding.rule === "unregistered").map((finding) => finding.matchedText)
    : [];
  const visibleFindings = result?.findings.filter((finding) => finding.rule !== "unregistered") ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
        <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          <form className="flex flex-col gap-3 xl:h-[min(72vh,56rem)] xl:min-h-[42rem]" onSubmit={checkDocument}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3">
                <span id="document-body-label" className="text-xs font-medium text-ink-2">문서 본문</span>
                {result && <button type="button" className="link text-xs" onClick={() => setResult(null)}>본문 수정</button>}
              </div>
              {result ? (
                <pre tabIndex={0} aria-labelledby="document-body-label" className="field mt-1.5 min-h-[28rem] w-full flex-1 overflow-auto whitespace-pre-wrap break-words border-line-strong bg-panel-2 font-mono text-sm leading-6 text-ink xl:min-h-0">
                  <HighlightedDocument content={content} result={result} />
                </pre>
              ) : (
                <textarea id="document-content" aria-labelledby="document-body-label" value={content} onChange={(event) => setContent(event.target.value)} disabled={checking} className="field mt-1.5 min-h-[28rem] w-full flex-1 resize-y border-line-strong bg-panel-2 font-mono text-sm leading-6 shadow-sm xl:min-h-0" placeholder="# 문서 제목\n\n본문을 붙여 넣으세요." maxLength={1_000_000} />
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3">
              <p className="text-xs text-ink-3">마크다운 · 최대 1,000,000자</p>
              <div className="flex items-center gap-3">
                <Link href="/api" className="link text-xs">API 자동화</Link>
                <button type="submit" className="btn-primary" disabled={checking}>{checking ? "점검 중…" : result ? "다시 점검" : "문서 점검"}</button>
              </div>
            </div>
          </form>
          <aside aria-label="문서 점검 결과" className="min-w-0 rounded-xl border border-line bg-panel-2/30 p-4 2xl:sticky 2xl:top-16 2xl:max-h-[calc(100vh-4.5rem)] 2xl:overflow-y-auto">
            {result ? (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink">점검 결과</h3>
                <div className="flex flex-wrap gap-2 text-xs text-ink-2" aria-live="polite">
                  <span className="rounded-full bg-panel-2 px-2.5 py-1">매칭 {result.stats.matched}</span>
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">오류 {result.stats.errors}</span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">주의 {result.stats.warnings}</span>
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand">미등록 {result.stats.unregistered}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-3" aria-label="본문 강조 표시 범례">
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-brand" />사전 등록</span>
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-warn" />미등록 후보</span>
                </div>
                <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft/40 p-4">
                  <h4 className="text-xs font-semibold text-ink">미등록 표기 <span className="font-normal text-ink-3">({unregisteredTerms.length})</span></h4>
                  <p className="mt-2 break-words text-sm leading-6 text-ink-2">{unregisteredTerms.length > 0 ? unregisteredTerms.join(", ") : "발견되지 않았습니다."}</p>
                </div>
                {result.highlightsTruncated && <p className="mt-3 text-xs text-ink-3">강조 표기가 5,000개를 넘어 일부는 표시하지 않았습니다.</p>}
                {visibleFindings.length > 0 ? (
                  <ul className="mt-4 divide-y divide-line border-y border-line">
                    {visibleFindings.map((finding, index) => (
                      <li key={`${finding.span.start}-${index}`} className="flex gap-3 py-3 text-xs">
                        <span className={finding.severity === "error" ? "text-red-700" : finding.severity === "warning" ? "text-amber-700" : "text-ink-3"}>
                          {finding.span.line}:{finding.span.col}
                        </span>
                        <span className="min-w-0"><strong className="font-medium text-ink">{finding.matchedText}</strong><span className="ml-2 text-ink-3">{finding.message}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : unregisteredTerms.length === 0 ? <p className="mt-4 text-sm text-ink-2">문제 없이 통과했습니다.</p> : null}
              </div>
            ) : <div className="flex min-h-36 items-center justify-center text-center text-sm leading-6 text-ink-3 2xl:min-h-64">
              <p>문서를 점검하면 등록 표기와 미등록 후보가 이곳에 표시됩니다.</p>
            </div>}
          </aside>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div><h3 className="text-base font-semibold text-ink">미등록 후보</h3><p className="mt-1 text-xs text-ink-3">발견 빈도가 높은 순서로 표시합니다. 현재 {total}개가 열려 있습니다.</p></div>
          <form className="flex gap-2" action="/check">
            <label className="sr-only" htmlFor="candidate-query">후보 검색</label>
            <input id="candidate-query" name="q" defaultValue={query} className="field h-9 w-48 text-xs" placeholder="후보 검색" />
            <button className="btn-quiet h-9 px-3 text-xs" type="submit">검색</button>
          </form>
        </div>
        {initialCandidates.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-line px-5 py-10 text-center"><p className="text-sm text-ink-2">열린 후보가 없습니다.</p><p className="mt-1 text-xs text-ink-3">문서를 점검하면 미등록 표기가 이곳에 쌓입니다.</p></div>
        ) : (
          <ul className="mt-4 space-y-3">
            {initialCandidates.map((candidate) => (
              <li key={candidate.id} className="rounded-2xl border border-line bg-panel p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-ink">{candidate.text}</h4><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">{candidate.occurrenceCount}회 발견</span></div>
                    <p className="mt-2 text-xs leading-5 text-ink-3">{candidate.sampleContext ?? "샘플 문맥 없음"}</p>
                    <p className="mt-2 text-[11px] text-ink-3">{candidate.source ?? "출처 정보 없음"} · 최근 {formatDate(candidate.lastSeenAt)}</p>
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
        {totalPages > 1 && <div className="mt-5 flex items-center justify-center gap-3 text-xs"><span className="text-ink-3">{page} / {totalPages}</span>{page > 1 && <Link className="link" href={`/check?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page - 1) })}`}>이전</Link>}{page < totalPages && <Link className="link" href={`/check?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page + 1) })}`}>다음</Link>}</div>}
      </section>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function HighlightedDocument({ content, result }: { content: string; result: ValidationResult }) {
  const highlights = [...(result.highlights ?? [])];
  const hasHighlightSpans = highlights.length > 0;
  for (const finding of result.findings) {
    const kind = finding.rule === "unregistered" ? "unregistered" : "registered";
    if (highlights.some((highlight) => highlight.kind === kind && highlight.span.start === finding.span.start && highlight.span.end === finding.span.end)) continue;

    if (hasHighlightSpans) {
      highlights.push({ kind, matchedText: finding.matchedText, span: finding.span });
      continue;
    }

    // Older validation responses only contain findings. Highlight their words
    // throughout the body so the result still points back to the document.
    let start = content.indexOf(finding.matchedText);
    while (start !== -1 && finding.matchedText.length > 0) {
      highlights.push({ kind, matchedText: finding.matchedText, span: { start, end: start + finding.matchedText.length } });
      start = content.indexOf(finding.matchedText, start + finding.matchedText.length);
    }
  }
  const ordered = highlights.sort((a, b) => {
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    if (a.kind !== b.kind) return a.kind === "registered" ? -1 : 1;
    return b.span.end - a.span.end;
  });
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const [index, highlight] of ordered.entries()) {
    const { start, end } = highlight.span;
    if (start < cursor || end <= start || end > content.length || content.slice(start, end) !== highlight.matchedText) continue;
    if (start > cursor) pieces.push(content.slice(cursor, start));
    pieces.push(<mark key={`${start}:${end}:${index}`} title={highlight.kind === "registered" ? "사전에 등록된 표기" : "미등록 후보"} className={highlight.kind === "registered" ? "rounded-sm border-b-2 border-brand bg-brand/20 px-0.5 font-semibold text-ink" : "rounded-sm border-b-2 border-warn bg-warn/25 px-0.5 font-semibold text-ink"}>{content.slice(start, end)}</mark>);
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
