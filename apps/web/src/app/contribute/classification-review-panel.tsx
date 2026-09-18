"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClassificationMultiSelect, type ClassificationOption } from "@/components/classification-multi-select";
import type { ClassificationReviewCandidate, ClassificationReviewKind } from "@/lib/terms/classification-review";
import { cx } from "@/lib/ui/format";

type Message = { kind: "ok" | "bad"; text: string } | null;
type ClassificationSuggestion = { revision: number; values: string[]; reason: string };
type AutoProgress = { active: boolean; total: number; completed: number };

function errorMessage(response: Response, fallback: string): Promise<string> {
  return response.json()
    .catch(() => null)
    .then((body) => (body as { error?: { message?: string } } | null)?.error?.message ?? `${fallback} (${response.status})`);
}

function contextText(candidate: ClassificationReviewCandidate): string {
  return candidate.definitionMd?.trim() || candidate.bodyMd?.trim() || "참고할 정의나 본문이 없습니다.";
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function ClassificationReviewPanel({
  kind,
  initialCandidates,
  query,
  aiAvailable,
  domainOptions,
  categoryOptions,
  basePath = "/contribute/fields",
}: {
  kind: ClassificationReviewKind;
  initialCandidates: ClassificationReviewCandidate[];
  query: string;
  aiAvailable: boolean;
  domainOptions: ClassificationOption[];
  categoryOptions: ClassificationOption[];
  basePath?: string;
}) {
  const [candidates, setCandidates] = useState<ClassificationReviewCandidate[]>(initialCandidates);
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>(() => Object.fromEntries(
    initialCandidates.map((candidate) => [candidate.id, kind === "domain" ? candidate.domain : candidate.categories]),
  ));
  const [suggestions, setSuggestions] = useState<Record<string, ClassificationSuggestion | null>>({});
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [noSuggestionIds, setNoSuggestionIds] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<Message>(null);
  const [autoProgress, setAutoProgress] = useState<AutoProgress>({ active: false, total: 0, completed: 0 });
  const generatingRef = useRef(new Set<string>());
  const handledRef = useRef(new Set<string>());
  const isDomain = kind === "domain";
  const label = isDomain ? "도메인" : "업무 분류";
  const options = isDomain ? domainOptions : categoryOptions;
  const otherOptions = isDomain ? categoryOptions : domainOptions;
  const refresh = isDomain
    ? { url: "/api/v1/admin/domains", responseKey: "domains" as const }
    : { url: "/api/v1/admin/categories", responseKey: "categories" as const };
  const manageHref = isDomain ? "/classifications" : "/classifications?view=categories";
  const fieldKey = isDomain ? "domain" : "category";

  function isGenerating(termId: string): boolean {
    return generatingIds.includes(termId);
  }

  function isSaving(termId: string): boolean {
    return savingIds.includes(termId);
  }

  function selectedFor(termId: string): string[] {
    return selectedValues[termId] ?? [];
  }

  function updateSelection(termId: string, selected: string[]): void {
    setSelectedValues((items) => ({ ...items, [termId]: selected }));
    setErrors((items) => {
      const next = { ...items };
      delete next[termId];
      return next;
    });
  }

  async function generate(candidate: ClassificationReviewCandidate, announce = true, skipHandled = false, force = false): Promise<void> {
    if (!aiAvailable || generatingRef.current.has(candidate.id) || isSaving(candidate.id)) return;
    if (skipHandled && handledRef.current.has(candidate.id)) return;
    generatingRef.current.add(candidate.id);
    setGeneratingIds((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    setErrors((items) => {
      const next = { ...items };
      delete next[candidate.id];
      return next;
    });
    if (announce) setMessage(null);
    try {
      const response = await fetch("/api/v1/contributions/classifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: candidate.id, kind, expectedRevision: candidate.revision, ...(force ? { force: true } : {}) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "AI 추천을 준비하지 못했습니다"));
      const body = await response.json() as { suggestion?: { revision?: unknown; values?: unknown; reason?: unknown } | null };
      const values = body.suggestion?.values;
      const reason = body.suggestion?.reason;
      const revision = body.suggestion?.revision;
      if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string") || typeof reason !== "string" || typeof revision !== "number") {
        setSuggestions((items) => ({ ...items, [candidate.id]: null }));
        setNoSuggestionIds((items) => ({ ...items, [candidate.id]: true }));
        if (announce) setMessage({ kind: "ok", text: `‘${candidate.name}’은 AI가 추천할 근거를 찾지 못했습니다. 직접 선택하거나 다시 시도해 주세요.` });
        return;
      }
      const suggestion = { revision, values, reason };
      setSuggestions((items) => ({ ...items, [candidate.id]: suggestion }));
      setNoSuggestionIds((items) => {
        const next = { ...items };
        delete next[candidate.id];
        return next;
      });
      setSelectedValues((items) => ({ ...items, [candidate.id]: values }));
      if (announce) setMessage({ kind: "ok", text: `‘${candidate.name}’의 AI 추천을 준비했습니다. 내용을 확인한 뒤 승인해 주세요.` });
    } catch (error) {
      setErrors((items) => ({ ...items, [candidate.id]: error instanceof Error ? error.message : "AI 추천을 준비하지 못했습니다." }));
    } finally {
      handledRef.current.add(candidate.id);
      generatingRef.current.delete(candidate.id);
      setGeneratingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  useEffect(() => {
    if (!aiAvailable || initialCandidates.length === 0) {
      setAutoProgress({ active: false, total: 0, completed: 0 });
      return;
    }

    let cancelled = false;
    let cursor = 0;
    let completed = 0;
    const pending = initialCandidates;
    const total = pending.length;
    setAutoProgress({ active: true, total, completed: 0 });

    const worker = async () => {
      while (!cancelled) {
        const candidate = pending[cursor];
        cursor += 1;
        if (!candidate) return;
        await generate(candidate, false, true);
        completed += 1;
        if (!cancelled) setAutoProgress({ active: true, total, completed });
      }
    };

    void Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker())).then(() => {
      if (!cancelled) setAutoProgress({ active: false, total, completed });
    });
    return () => { cancelled = true; };
  }, [aiAvailable, initialCandidates]);

  function discardSuggestion(candidate: ClassificationReviewCandidate): void {
    handledRef.current.delete(candidate.id);
    setNoSuggestionIds((items) => ({ ...items, [candidate.id]: true }));
    setSuggestions((items) => ({ ...items, [candidate.id]: null }));
    setSelectedValues((items) => ({ ...items, [candidate.id]: [] }));
    setMessage({ kind: "ok", text: `‘${candidate.name}’의 AI 추천을 버렸습니다. 다시 추천받거나 직접 선택할 수 있습니다.` });
  }

  async function save(candidate: ClassificationReviewCandidate): Promise<void> {
    const selected = selectedFor(candidate.id);
    const suggestion = suggestions[candidate.id];
    if (selected.length === 0 || isSaving(candidate.id) || isGenerating(candidate.id)) return;
    handledRef.current.add(candidate.id);
    setSavingIds((items) => items.includes(candidate.id) ? items : [...items, candidate.id]);
    setMessage(null);
    try {
      const patch = isDomain ? { domain: selected } : { category: selected };
      const response = await fetch(`/api/v1/terms/${encodeURIComponent(candidate.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, expectedRevision: candidate.revision }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, `${label}을 저장하지 못했습니다`));
      setCandidates((items) => items.filter((item) => item.id !== candidate.id));
      setSelectedValues((items) => {
        const next = { ...items };
        delete next[candidate.id];
        return next;
      });
      setSuggestions((items) => {
        const next = { ...items };
        delete next[candidate.id];
        return next;
      });
      setErrors((items) => {
        const next = { ...items };
        delete next[candidate.id];
        return next;
      });
      setMessage({
        kind: "ok",
        text: suggestion && sameValues(selected, suggestion.values)
          ? `‘${candidate.name}’의 ${label} 추천을 승인하고 저장했습니다.`
          : `‘${candidate.name}’의 수정한 ${label}을 저장했습니다.`,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : `${label}을 저장하지 못했습니다.`;
      setErrors((items) => ({ ...items, [candidate.id]: text }));
      setMessage({ kind: "bad", text });
    } finally {
      setSavingIds((items) => items.filter((id) => id !== candidate.id));
    }
  }

  return (
    <section aria-label={`${label} 보완 목록`} className="space-y-3">
      {autoProgress.active && <p role="status" className="text-xs text-brand">AI 추천 준비 중 {autoProgress.completed}/{autoProgress.total}</p>}

      <form action={basePath} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="field" value={fieldKey} />
        <label className="min-w-0 flex-1 text-xs text-ink-2">용어 필터
          <input name="q" defaultValue={query} autoComplete="off" placeholder="특정 단어가 들어간 용어…" className="mt-1 block w-full rounded-lg border border-line bg-panel p-2 text-sm text-ink" />
        </label>
        <button type="submit" className="btn-primary btn-sm">필터</button>
        {query && <Link href={`${basePath}?field=${fieldKey}`} className="btn-quiet btn-sm">초기화</Link>}
      </form>

      <div className="card overflow-hidden">
        {candidates.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-3">정리할 용어가 없습니다.</p>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">{label}이 비어 있는 용어 목록</caption>
              <thead className="bg-panel-2/55 text-xs text-ink-2">
                <tr>
                  <th scope="col" className={cx("border-b border-line px-4 py-3 font-semibold", isDomain ? "w-[17%]" : "w-[16%]")}>용어</th>
                  {!isDomain && <th scope="col" className="w-[16%] border-b border-line px-4 py-3 font-semibold">도메인</th>}
                  <th scope="col" className={cx("border-b border-line px-4 py-3 font-semibold", isDomain ? "w-[28%]" : "w-[24%]")}>참고 내용</th>
                  <th scope="col" className={cx("border-b border-line px-4 py-3 font-semibold", isDomain ? "w-[37%]" : "w-[30%]")}>{label}</th>
                  <th scope="col" className={cx("border-b border-line px-4 py-3 text-right font-semibold", isDomain ? "w-[18%]" : "w-[14%]")}>처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {candidates.map((candidate) => {
                  const error = errors[candidate.id];
                  const generating = isGenerating(candidate.id);
                  const saving = isSaving(candidate.id);
                  const selected = selectedFor(candidate.id);
                  const suggestion = suggestions[candidate.id];
                  const suggestionApproved = Boolean(suggestion && sameValues(selected, suggestion.values));
                  const currentOtherValues = isDomain ? candidate.categories : candidate.domain;
                  const currentOtherLabels = currentOtherValues.map((value) => otherOptions.find((option) => option.value === value)?.label ?? value);
                  const suggestionLabels = suggestion?.values.map((value) => options.find((option) => option.value === value)?.label ?? value) ?? [];
                  return (
                    <tr key={candidate.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link href={`/edit/${candidate.slug}`} className="font-semibold text-ink hover:text-brand">{candidate.name}</Link>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{candidate.fullNameEn || candidate.fullNameKo || `/${candidate.slug}`}</p>
                      </td>
                      {!isDomain && (
                        <td className="px-4 py-3">
                          {currentOtherLabels.length > 0 ? (
                            <div className="flex flex-wrap gap-1" aria-label="도메인">
                              {currentOtherLabels.map((value) => <span key={value} className="chip">{value}</span>)}
                            </div>
                          ) : <span className="text-xs text-ink-3">없음</span>}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-ink-2">{contextText(candidate)}</p>
                        {isDomain && currentOtherLabels.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1" aria-label="기존 분류">
                            {currentOtherLabels.map((value) => <span key={value} className="chip">{value}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {suggestion && (
                          <div className="mb-2 rounded-lg border border-brand/25 bg-brand-soft/45 p-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="chip chip-on !py-0.5 !text-[11px]">AI 추천</span>
                              {suggestionLabels.map((value) => <span key={value} className="chip !py-0.5 !text-[11px]">{value}</span>)}
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-ink-2">{suggestion.reason}</p>
                          </div>
                        )}
                        <ClassificationMultiSelect
                          name={`${kind}-${candidate.id}`}
                          label={label}
                          help={isDomain ? "용어가 속한 제품·기술·사업 영역을 하나 이상 선택합니다." : "용어가 관련된 업무 분류를 하나 이상 선택합니다."}
                          placeholder="분류 검색…"
                          selected={selected}
                          initialOptions={options}
                          kind={kind}
                          manageHref={manageHref}
                          refresh={refresh}
                          disabled={saving || generating}
                          hideLabel
                          compact
                          onChange={(values) => updateSelection(candidate.id, values)}
                        />
                        {error && <p role="alert" className="mt-1 truncate text-xs text-danger" title={error}>{error}</p>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {suggestion ? (
                            <>
                              <button type="button" className="btn-quiet btn-sm" disabled={saving || generating} onClick={() => discardSuggestion(candidate)}>추천 버리기</button>
                              <button type="button" className="btn-primary btn-sm" disabled={saving || generating || selected.length === 0} onClick={() => void save(candidate)}>
                                {saving ? "저장 중…" : suggestionApproved ? "승인하고 저장" : "수정 후 저장"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="btn-quiet btn-sm" disabled={!aiAvailable || saving || generating} title={!aiAvailable ? "관리자가 AI 연결을 활성화해야 사용할 수 있습니다." : undefined} onClick={() => void generate(candidate, true, false, Boolean(noSuggestionIds[candidate.id] || error))}>
                                {generating ? "추천 중…" : aiAvailable ? "AI 추천" : "AI 연결 필요"}
                              </button>
                              <button type="button" className="btn-primary btn-sm" disabled={saving || generating || selected.length === 0} onClick={() => void save(candidate)}>
                                {saving ? "저장 중…" : "직접 저장"}
                              </button>
                            </>
                          )}
                        </div>
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
