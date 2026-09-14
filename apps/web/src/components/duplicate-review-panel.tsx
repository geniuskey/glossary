"use client";

import { useEffect, useRef, useState } from "react";
import type { DuplicateCandidate, DuplicateInput } from "@/lib/ai/duplicate-review";

const verdictLabel = { same: "같은 개념", different: "다른 개념", uncertain: "판단 보류" };
export function DuplicateReviewPanel({ initialQuery = "" }: { initialQuery?: string }) {
  const [items, setItems] = useState<DuplicateInput[]>([]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(initialQuery);
  const [review, setReview] = useState<{ source: DuplicateInput; revision: number; candidates: DuplicateCandidate[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/contributions/duplicates?page=${page}`, { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error?.message ?? "후보를 불러오지 못했습니다.");
      setItems(body.items);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [page]);
  async function inspect(termId: string) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setMessage(""); setReview(null);
    try {
      if (!items.some((item) => item.id === termId)) {
        const response = await fetch(`/api/v1/terms/${encodeURIComponent(termId)}`);
        const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "용어를 찾을 수 없습니다.");
        termId = body.term.id;
      }
      const response = await fetch("/api/v1/contributions/duplicates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ termId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "검토하지 못했습니다.");
      setReview(body);
    } catch (e) { setError(e instanceof Error ? e.message : "검토하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function merge(candidate: DuplicateCandidate) {
    if (!review || !candidate.revision || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/contributions/duplicates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: review.source.id, targetId: candidate.id, sourceRevision: review.revision, targetRevision: candidate.revision }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "병합하지 못했습니다.");
      setItems((rows) => rows.filter((row) => row.id !== review.source.id));
      setMessage(`/${body.slug} 용어로 합쳤습니다. 다른 용어를 계속 검토할 수 있습니다.`); setReview(null);
    } catch (e) { setError(e instanceof Error ? e.message : "병합하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="space-y-4" aria-label="AI 중복 용어 정리">
    <p className="text-sm text-ink-2">표기가 겹치거나 URL에 숫자 접미사가 있는 용어를 먼저 보여드립니다. AI가 정의와 도메인을 비교한 뒤 같은 개념인 후보를 제안합니다. 다른 용어도 URL 슬러그로 찾아 검토할 수 있습니다.</p>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void inspect(query.trim()); }}>
      <input aria-label="검토할 용어 URL 슬러그" className="min-w-0 flex-1 rounded border border-line bg-panel p-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: auto-exposure-2" />
      <button className="btn-primary" disabled={busy || !query.trim()}>AI 중복 검토</button>
    </form>
    {busy && <p role="status">처리 중…</p>}
    {error && <p role="alert" className="note-danger">{error}</p>}
    {message && <p role="status" className="note-warn">{message}</p>}
    {review && <div className="card space-y-3 p-4">
      <h2 className="font-semibold">{review.source.nameKo || review.source.nameEn} · /{review.source.slug}</h2>
      <p className="text-sm">{review.source.definitionMd || "정의 없음"}</p>
      {review.source.bodyMd && <details><summary className="cursor-pointer text-sm">원본 본문 보기</summary><p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{review.source.bodyMd}</p></details>}
      <p className="text-xs text-ink-2">선택한 대표 용어의 이름·정의를 유지하고, 양쪽 표기·분류·본문을 보존합니다. 원래 URL은 대표 용어로 연결되며 원본 이력도 남습니다. 원본에 연결된 관계는 원본 기록에 보존됩니다.</p>
      {review.candidates.length === 0 && <p>유사 후보가 없습니다.</p>}
      {review.candidates.map((candidate) => <article key={candidate.id} className="space-y-2 rounded border border-line p-3">
        <a className="link" href={`/w/${candidate.slug}`} target="_blank" rel="noreferrer">{candidate.nameKo || candidate.nameEn} · /{candidate.slug}</a>
        <p className="text-sm">{candidate.definitionMd || "정의 없음"}</p>
        <p className="text-xs text-ink-3">도메인: {candidate.domain?.join(" · ") || "없음"}</p>
        <p className="text-sm"><strong>{verdictLabel[candidate.verdict]}</strong> — {candidate.reason}</p>
        {candidate.verdict === "same" && <button className="btn-primary btn-sm" disabled={busy} onClick={() => void merge(candidate)}>이 용어를 대표로 병합 승인</button>}
        <button className="btn-quiet btn-sm" disabled={busy} onClick={() => setReview((r) => r && ({ ...r, candidates: r.candidates.filter((c) => c.id !== candidate.id) }))}>이번에 건너뛰기</button>
      </article>)}
    </div>}
    <ul className="space-y-2">{items.map((item) => <li key={item.id} className="card flex items-center justify-between gap-3 p-3">
      <span className="min-w-0 break-words">{item.nameKo || item.nameEn} <span className="text-xs text-ink-3">/{item.slug}</span></span>
      <button className="btn-quiet btn-sm shrink-0" disabled={busy} onClick={() => void inspect(item.id)}>AI 검토</button>
    </li>)}</ul>
    {!items.length && <p className="text-sm text-ink-2">이 페이지에 중복 표기 후보가 없습니다.</p>}
    <div className="flex gap-3"><button className="btn-quiet" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>이전</button><span>{page}페이지</span><button className="btn-quiet" disabled={busy || items.length < 50} onClick={() => setPage(page + 1)}>다음</button></div>
  </section>;
}
