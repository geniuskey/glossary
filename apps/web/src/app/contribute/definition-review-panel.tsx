"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DefinitionReviewCandidate } from "@/lib/ai/definition-review";
import { AI_SUGGESTION_GENERATOR_VERSIONS } from "@/lib/ai/suggestion-disposition-values";
import { cx } from "@/lib/ui/format";
import { SuggestionDispositionActions } from "./suggestion-disposition-actions";

type Message = { kind: "ok" | "bad"; text: string } | null;
type DefinitionReviewRow = Omit<DefinitionReviewCandidate, "suggestion"> & { suggestion: string | null };

function normalizeCandidate(candidate: DefinitionReviewCandidate): DefinitionReviewRow {
  return { ...candidate, suggestion: candidate.suggestion ?? null };
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status}).`;
}

export function DefinitionReviewPanel({ initialCandidates, aiAvailable }: {
  initialCandidates: DefinitionReviewCandidate[];
  aiAvailable: boolean;
}) {
  const [candidates, setCandidates] = useState<DefinitionReviewRow[]>(() => initialCandidates.map(normalizeCandidate));
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  const generatingRef = useRef(new Set<string>());
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>(null);

  function isGenerating(termId: string): boolean {
    return generatingIds.includes(termId);
  }

  function isApproving(termId: string): boolean {
    return approvingIds.includes(termId);
  }

  async function generate(candidate: DefinitionReviewRow, force = false): Promise<void> {
    if (generatingRef.current.has(candidate.id)) return;
    generatingRef.current.add(candidate.id);
    setGeneratingIds((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    setErrors((items) => {
      const next = { ...items };
      delete next[candidate.id];
      return next;
    });
    try {
      const response = await fetch("/api/v1/contributions/term-definitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: candidate.id, ...(force ? { force: true } : {}) }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "한줄 정의를 정리하지 못했습니다"));
      const body = await response.json() as { suggestion?: unknown };
      if (typeof body.suggestion !== "string" || !body.suggestion.trim()) throw new Error("한줄 정의 제안을 받지 못했습니다.");
      setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, suggestion: body.suggestion as string } : item));
    } catch (error) {
      setErrors((items) => ({ ...items, [candidate.id]: error instanceof Error ? error.message : "한줄 정의를 정리하지 못했습니다." }));
    } finally {
      generatingRef.current.delete(candidate.id);
      setGeneratingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  useEffect(() => {
    if (!aiAvailable) return;
    const pending = initialCandidates.map(normalizeCandidate).filter((candidate) => !candidate.suggestion?.trim());
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const candidate = pending[cursor];
        cursor += 1;
        if (candidate) await generate(candidate);
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker()));
  }, [aiAvailable, initialCandidates]);

  async function approve(candidate: DefinitionReviewRow): Promise<void> {
    const definitionMd = candidate.suggestion?.trim();
    if (!definitionMd || isApproving(candidate.id) || isGenerating(candidate.id)) return;
    setApprovingIds((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/term-definitions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: candidate.id, definitionMd, expectedRevision: candidate.revision }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "한줄 정의를 승인하지 못했습니다"));
      setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      setErrors((items) => {
        const next = { ...items };
        delete next[candidate.id];
        return next;
      });
      setMessage({ kind: "ok", text: `‘${candidate.name}’의 한줄 정의를 승인했습니다.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : "한줄 정의를 승인하지 못했습니다.";
      setErrors((items) => ({ ...items, [candidate.id]: text }));
      setMessage({ kind: "bad", text });
    } finally {
      setApprovingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  return (
    <section aria-label="한줄 정의 보완 목록" className="space-y-3">
      <div className="card overflow-hidden">
        {candidates.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-3">정리할 용어가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
              <caption className="sr-only">본문이 있지만 한줄 정의가 없는 용어와 LLM 제안</caption>
              <thead className="bg-panel-2/55 text-xs text-ink-2">
                <tr>
                  <th scope="col" className="w-[17%] border-b border-line px-4 py-3 font-semibold">용어</th>
                  <th scope="col" className="w-[25%] border-b border-line px-4 py-3 font-semibold">본문 근거</th>
                  <th scope="col" className="w-[50%] border-b border-line px-4 py-3 font-semibold">한줄 정의 제안</th>
                  <th scope="col" className="w-[8%] border-b border-line px-4 py-3 text-right font-semibold">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {candidates.map((candidate) => {
                  const generating = isGenerating(candidate.id);
                  const approving = isApproving(candidate.id);
                  const hasSuggestion = Boolean(candidate.suggestion?.trim());
                  const error = errors[candidate.id];
                  return (
                    <tr key={candidate.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/edit/${candidate.slug}`} className="font-semibold text-ink hover:text-brand">{candidate.name}</Link>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{candidate.fullNameEn || candidate.fullNameKo || `/${candidate.slug}`}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="line-clamp-4 max-w-[32rem] whitespace-pre-wrap text-xs leading-5 text-ink-2">{candidate.bodyMd}</p>
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          aria-label={`${candidate.name} 한줄 정의 제안`}
                          value={candidate.suggestion ?? ""}
                          onChange={(event) => setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, suggestion: event.currentTarget.value.replace(/[\r\n]+/g, " ") } : item))}
                          rows={2}
                          maxLength={1_000}
                          disabled={generating || approving}
                          placeholder={generating ? "LLM 제안 준비 중…" : "직접 입력하거나 LLM 정리를 실행하세요…"}
                          className="field min-h-20 w-full resize-y text-sm leading-5"
                        />
                        {candidate.disposition === "deferred" && <p className="mt-1 text-[11px] text-warn">보류된 제안입니다. 추가 근거를 확인해 주세요.</p>}
                        <div className="mt-1 flex min-h-5 items-center gap-2">
                          {error && <p role="alert" className="min-w-0 flex-1 truncate text-xs text-danger" title={error}>{error}</p>}
                          {hasSuggestion && <button type="button" className="link ml-auto shrink-0 text-xs" disabled={generating || approving || !aiAvailable} onClick={() => void generate(candidate, true)}>다시 정리</button>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {hasSuggestion ? (
                          <>
                            <button type="button" className="btn-primary btn-sm" disabled={generating || approving} onClick={() => void approve(candidate)}>
                              {approving ? "저장 중…" : "승인"}
                            </button>
                            <SuggestionDispositionActions
                              termId={candidate.id}
                              revision={candidate.revision}
                              feature="definition"
                              suggestionId="definition"
                              generatorVersion={AI_SUGGESTION_GENERATOR_VERSIONS.definition}
                              payload={{ title: "한줄 정의", field: "definitionMd", value: candidate.suggestion ?? "", reason: "AI 한줄 정의 제안" }}
                              disabled={generating || approving}
                              onApplied={(disposition) => {
                                if (disposition === "dismissed" || disposition === "saved") {
                                  setCandidates((items) => items.filter((item) => item.id !== candidate.id));
                                } else {
                                  setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, disposition } : item));
                                }
                                setMessage({ kind: "ok", text: disposition === "dismissed" ? "오탐으로 숨겼습니다." : disposition === "saved" ? "내 작업에 저장했습니다." : "보류로 기록했습니다." });
                              }}
                            />
                          </>
                        ) : error ? (
                          <button type="button" className="btn-quiet btn-sm" disabled={generating || approving || !aiAvailable} onClick={() => void generate(candidate, true)}>
                            다시 정리
                          </button>
                        ) : generating ? (
                          <span role="status" className="text-xs text-brand">정리 중…</span>
                        ) : aiAvailable ? (
                          <button type="button" className="btn-quiet btn-sm" disabled={approving} onClick={() => void generate(candidate, true)}>
                            LLM 정리
                          </button>
                        ) : (
                          <span role="status" className="text-xs text-ink-3">AI 연결 필요</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("border-t border-line px-4 py-2.5 text-xs", message.kind === "bad" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>{message.text}</p>}
      </div>
    </section>
  );
}
