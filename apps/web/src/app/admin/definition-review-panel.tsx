"use client";

import Link from "next/link";
import { useState } from "react";
import type { DefinitionReviewCandidate } from "@/lib/ai/definition-review";
import { cx } from "@/lib/ui/format";
import { HelpTip } from "@/components/help-tip";

type Message = { kind: "ok" | "bad"; text: string } | null;

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status}).`;
}

export function DefinitionReviewPanel({ initialCandidates }: { initialCandidates: DefinitionReviewCandidate[] }) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [suggestion, setSuggestion] = useState("");
  const [suggestionFor, setSuggestionFor] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const current = candidates[0];

  function clearSuggestion() {
    setSuggestion("");
    setSuggestionFor(null);
  }

  async function generate() {
    if (!current || generating || approving) return;
    setGenerating(true);
    setMessage(null);
    clearSuggestion();
    try {
      const response = await fetch("/api/v1/admin/term-definitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: current.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "한줄 정의를 정리하지 못했습니다"));
      const body = await response.json() as { suggestion: string };
      setSuggestion(body.suggestion);
      setSuggestionFor(current.id);
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "한줄 정의를 정리하지 못했습니다." });
    } finally {
      setGenerating(false);
    }
  }

  async function approve() {
    if (!current || suggestionFor !== current.id || !suggestion.trim() || generating || approving) return;
    setApproving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/term-definitions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: current.id,
          definitionMd: suggestion.trim(),
          expectedRevision: current.revision,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "한줄 정의를 승인하지 못했습니다"));
      const approvedName = current.name;
      setCandidates((items) => items.slice(1));
      clearSuggestion();
      setMessage({ kind: "ok", text: `‘${approvedName}’의 한줄 정의를 승인했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "한줄 정의를 승인하지 못했습니다." });
    } finally {
      setApproving(false);
    }
  }

  function skip() {
    if (candidates.length <= 1 || !current) return;
    setCandidates((items) => [...items.slice(1), items[0]!]);
    clearSuggestion();
    setMessage(null);
  }

  return (
    <section aria-labelledby="definition-review-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="definition-review-heading" className="text-base font-semibold text-ink">LLM 한줄 정의 정리</h2>
        <HelpTip text="본문은 있지만 한줄 정의가 없는 용어만 대상으로 삼습니다. LLM 제안을 관리자가 직접 고치고 한 건씩 승인해야 실제 용어에 저장됩니다." />
        <p className="ml-auto text-xs tabular-nums text-ink-3">대기 {candidates.length.toLocaleString("ko-KR")}개</p>
      </div>

      <div className="card overflow-hidden">
        {!current ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">정리할 용어가 없습니다.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/55 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{current.name}</p>
                <p className="truncate font-mono text-[11px] text-ink-3">/{current.slug}</p>
              </div>
              <Link href={`/edit/${current.slug}`} className="btn-quiet btn-sm ml-auto">직접 편집</Link>
              <button type="button" className="btn-quiet btn-sm" disabled={candidates.length <= 1 || generating || approving} onClick={skip}>건너뛰기</button>
            </header>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-semibold text-ink-2">본문 근거</p>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2/45 p-3 font-sans text-xs leading-5 text-ink-2">{current.bodyMd}</pre>
              </div>
              <div className="min-w-0">
                <label htmlFor="definition-suggestion" className="mb-2 block text-xs font-semibold text-ink-2">한줄 정의 제안</label>
                <input
                  id="definition-suggestion"
                  value={suggestionFor === current.id ? suggestion : ""}
                  onChange={(event) => { setSuggestion(event.target.value.replace(/[\r\n]+/g, " ")); setSuggestionFor(current.id); }}
                  maxLength={1_000}
                  disabled={generating || approving}
                  placeholder="LLM 정리를 실행하거나 직접 입력하세요…"
                  className="field"
                />
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={generating || approving} onClick={() => void generate()}>
                    {generating ? "정리 중…" : suggestionFor === current.id ? "다시 정리" : "LLM 정리"}
                  </button>
                  <button type="button" className="btn-primary btn-sm" disabled={generating || approving || suggestionFor !== current.id || !suggestion.trim()} onClick={() => void approve()}>
                    {approving ? "승인 중…" : "검토 후 승인"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("border-t border-line px-4 py-2.5 text-xs", message.kind === "bad" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{message.text}</p>}
      </div>
    </section>
  );
}
