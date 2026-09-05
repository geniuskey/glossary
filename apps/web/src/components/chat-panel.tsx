"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HelpTip } from "./help-tip";
import { MarkdownContent } from "./markdown-content";
import {
  teachingDraftHasMeaning,
  teachingDraftName,
  type TermTeachingBatch,
  type TermTeachingDraft,
} from "@/lib/ai/teaching-values";
import { cx } from "@/lib/ui/format";

interface Source { slug: string; title: string; definition: string | null; status: "active" | "deprecated" | "forbidden" }
interface Teaching { draft: TermTeachingDraft; ready: boolean }
interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  teaching?: Teaching;
  teachingBatch?: TermTeachingBatch;
  created?: Array<{ slug: string; title: string }>;
  failed?: boolean;
}

const EXAMPLES = ["IT와 SW는 무엇을 뜻해?", "이 용어의 권장 표기는 뭐야?", "T/O라는 새 용어를 등록하고 싶어"];

function isLargePastedMessage(content: string): boolean {
  return content.length > 500 || content.split(/\r?\n/).length > 5;
}

export function ChatPanel({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<number | null>(null);
  const [draftError, setDraftError] = useState<{ id: number; text: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  let nextId = messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  function activeTeachingDraft(): TermTeachingDraft | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.teaching?.draft) return messages[index]!.teaching!.draft;
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || sending || !enabled) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(-4_000) }));
    const userId = nextId++;
    setMessages((current) => [...current, { id: userId, role: "user", content: text }]);
    setQuestion("");
    setSending(true);
    try {
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history, teachingDraft: activeTeachingDraft() }),
      });
      const body = await response.json().catch(() => null) as { answer?: string; sources?: Source[]; teaching?: Teaching; teachingBatch?: TermTeachingBatch; error?: { message?: string } } | null;
      setMessages((current) => [
        ...current.map((message) => message.teaching || message.teachingBatch ? { ...message, teaching: undefined, teachingBatch: undefined } : message),
        {
          id: userId + 1,
          role: "assistant",
          content: response.ok && body?.answer ? body.answer : body?.error?.message || `답변을 받지 못했습니다 (${response.status}).`,
          sources: body?.sources,
          teaching: body?.teaching,
          teachingBatch: body?.teachingBatch,
          failed: !response.ok,
        },
      ]);
      setDraftError(null);
    } catch {
      setMessages((current) => [...current, { id: userId + 1, role: "assistant", content: "네트워크 오류로 답변을 받지 못했습니다.", failed: true }]);
    } finally {
      setSending(false);
    }
  }

  async function postTermDraft(draft: TermTeachingDraft): Promise<
    { ok: true; term: { slug: string; title: string } } | { ok: false; error: string }
  > {
    const response = await fetch("/api/v1/terms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        termType: "concept",
        qualityProfile: "auto",
        nameEn: draft.nameEn,
        nameKo: draft.nameKo,
        fullNameEn: draft.fullNameEn,
        fullNameKo: draft.fullNameKo,
        definitionMd: draft.definitionMd || undefined,
        bodyMd: draft.bodyMd || undefined,
        domain: [],
        category: [],
        status: "draft",
        surfaces: [],
      }),
    });
    const body = await response.json().catch(() => null) as {
      term?: { slug?: string; nameEn?: string | null; nameKo?: string | null };
      error?: { message?: string; details?: { formErrors?: string[] } };
    } | null;
    if (!response.ok || !body?.term?.slug) {
      return {
        ok: false,
        error: body?.error?.details?.formErrors?.join(" ") || body?.error?.message || `초안을 추가하지 못했습니다 (${response.status}).`,
      };
    }
    return {
      ok: true,
      term: { slug: body.term.slug, title: body.term.nameKo || body.term.nameEn || teachingDraftName(draft) },
    };
  }

  async function createTermFromDraft(messageId: number, draft: TermTeachingDraft) {
    if (creatingDraftId !== null) return;
    setCreatingDraftId(messageId);
    setDraftError(null);
    try {
      const result = await postTermDraft(draft);
      if (!result.ok) {
        setDraftError({ id: messageId, text: result.error });
        return;
      }
      setMessages((current) => {
        const nextId = current.reduce((max, message) => Math.max(max, message.id), 0) + 1;
        return [
          ...current.map((message) => message.id === messageId ? { ...message, teaching: undefined } : message),
          {
            id: nextId,
            role: "assistant",
            content: `“${result.term.title}”를 비공개 초안으로 추가했습니다. 공개하기 전에 분류와 내용을 검토해 주세요.`,
            created: [result.term],
          },
        ];
      });
    } catch {
      setDraftError({ id: messageId, text: "네트워크 오류로 초안을 추가하지 못했습니다." });
    } finally {
      setCreatingDraftId(null);
    }
  }

  async function createTermsFromBatch(messageId: number, drafts: TermTeachingDraft[]) {
    if (creatingDraftId !== null) return;
    setCreatingDraftId(messageId);
    setDraftError(null);
    try {
      const results = await Promise.all(drafts.map((draft) => postTermDraft(draft)));
      const created = results.flatMap((result) => result.ok ? [result.term] : []);
      const failed = results.flatMap((result, index) => result.ok ? [] : [`${teachingDraftName(drafts[index]!)}: ${result.error}`]);
      if (created.length === 0) {
        setDraftError({ id: messageId, text: failed.join(" ") || "추가할 수 있는 용어가 없습니다." });
        return;
      }
      setMessages((current) => {
        const nextId = current.reduce((max, message) => Math.max(max, message.id), 0) + 1;
        const failureNote = failed.length > 0
          ? `\n\n추가하지 못한 ${failed.length}개 항목:\n${failed.slice(0, 8).map((item) => `- ${item}`).join("\n")}${failed.length > 8 ? `\n- 그 외 ${failed.length - 8}개` : ""}`
          : "";
        return [
          ...current.map((message) => message.id === messageId ? { ...message, teachingBatch: undefined } : message),
          {
            id: nextId,
            role: "assistant",
            content: `${created.length}개 용어를 비공개 초안으로 추가했습니다. 공개하기 전에 각 용어의 분류와 내용을 검토해 주세요.${failureNote}`,
            created,
          },
        ];
      });
    } catch {
      setDraftError({ id: messageId, text: "네트워크 오류로 용어 초안을 추가하지 못했습니다." });
    } finally {
      setCreatingDraftId(null);
    }
  }

  function cancelTeaching(messageId: number) {
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, teaching: undefined, teachingBatch: undefined } : message));
    setDraftError(null);
  }

  return (
    <section className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-4xl flex-col" aria-labelledby="chat-heading">
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <h2 id="chat-heading" className="text-base font-semibold text-ink">용어 챗봇</h2>
        <HelpTip text="공개 용어를 근거로 답합니다. 모르는 용어는 대화로 정보를 받은 뒤 확인한 초안만 용어집에 추가합니다." />
        {messages.length > 0 && <button type="button" className="btn-quiet btn-sm ml-auto" onClick={() => setMessages([])} disabled={sending}>대화 지우기</button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-panel-2/35 p-3 sm:p-4" role="log" aria-live="polite" aria-label="용어 챗봇 대화">
        {!enabled ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <p className="text-sm font-medium text-ink">용어 챗봇이 아직 연결되지 않았습니다.</p>
              <p className="mt-1 text-xs text-ink-3">관리자가 AI 연결을 설정하고 활성화해야 합니다.</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div className="max-w-lg">
              <p className="text-sm font-medium text-ink">용어를 질문하거나, 모르는 용어를 대화로 가르쳐 주세요.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => <button key={example} type="button" className="chip hover:border-brand/40 hover:text-brand" onClick={() => setQuestion(example)}>{example}</button>)}
              </div>
            </div>
          </div>
        ) : (
          <ol className="space-y-4">
            {messages.map((message) => (
              <li key={message.id} className={cx("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <article className={cx(
                  "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm",
                  message.role === "user" ? "rounded-br-md bg-brand text-brand-on" : message.failed ? "rounded-bl-md border border-danger/30 bg-danger-soft text-danger" : "rounded-bl-md border border-line bg-panel text-ink",
                )}>
                  {message.role === "assistant"
                    ? <MarkdownContent className="break-words text-sm leading-6">{message.content}</MarkdownContent>
                    : isLargePastedMessage(message.content) ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">붙여넣은 내용 · {message.content.split(/\r?\n/).filter(Boolean).length}줄</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-white/25 pt-2 font-sans text-xs leading-5">{message.content}</pre>
                      </details>
                    ) : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-2" aria-label="답변에 참고한 용어">
                      {message.sources.map((source) => (
                        <Link key={source.slug} href={`/w/${source.slug}`} className="chip max-w-48 truncate hover:border-brand/40 hover:text-brand" title={source.definition || source.title}>
                          {source.title}
                        </Link>
                      ))}
                    </div>
                  )}
                  {message.teaching && (
                    <div className="mt-3 rounded-xl border border-brand/25 bg-brand-soft/45 p-3 text-ink" aria-label="용어 등록 초안">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{teachingDraftName(message.teaching.draft)}</p>
                        <span className={cx("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold", message.teaching.ready ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>{message.teaching.ready ? "등록 준비됨" : "정보 수집 중"}</span>
                      </div>
                      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[5rem_1fr]">
                        <dt className="text-ink-3">Full name</dt>
                        <dd>{message.teaching.draft.fullNameKo || message.teaching.draft.fullNameEn || (message.teaching.draft.skipped.fullName ? "생략" : "—")}</dd>
                        <dt className="text-ink-3">한줄 정의</dt>
                        <dd className="whitespace-pre-wrap">{message.teaching.draft.definitionMd || (message.teaching.draft.skipped.definition ? "생략" : "—")}</dd>
                        <dt className="text-ink-3">설명</dt>
                        <dd className="line-clamp-4 whitespace-pre-wrap">{message.teaching.draft.bodyMd || (message.teaching.draft.skipped.body ? "생략" : "—")}</dd>
                      </dl>
                      {draftError?.id === message.id && <p className="mt-2 text-xs text-danger" role="alert">{draftError.text}</p>}
                      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-brand/15 pt-2">
                        <button type="button" className="btn-quiet btn-sm" onClick={() => cancelTeaching(message.id)} disabled={creatingDraftId === message.id}>취소</button>
                        {message.teaching.ready && <button type="button" className="btn-primary btn-sm" onClick={() => void createTermFromDraft(message.id, message.teaching!.draft)} disabled={creatingDraftId !== null}>{creatingDraftId === message.id ? "추가 중…" : "초안으로 추가"}</button>}
                      </div>
                    </div>
                  )}
                  {message.teachingBatch && (
                    <div className="mt-3 rounded-xl border border-brand/25 bg-brand-soft/45 p-3 text-ink" aria-label="붙여넣은 용어 초안">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">붙여넣은 용어 {message.teachingBatch.drafts.length}개</p>
                        <span className="ml-auto rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn">확인 필요</span>
                      </div>
                      <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {message.teachingBatch.drafts.map((draft, index) => (
                          <div key={`${teachingDraftName(draft)}:${index}`} className="rounded-lg border border-line/80 bg-panel/80 px-2.5 py-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-ink">{teachingDraftName(draft)}</span>
                              {(draft.fullNameKo || draft.fullNameEn) && <span className="truncate text-ink-3">{draft.fullNameKo || draft.fullNameEn}</span>}
                              {!teachingDraftHasMeaning(draft) && <span className="ml-auto shrink-0 text-[10px] text-warn">내용 부족</span>}
                            </div>
                            {draft.definitionMd && <p className="mt-0.5 line-clamp-2 text-ink-2">{draft.definitionMd}</p>}
                          </div>
                        ))}
                      </div>
                      {draftError?.id === message.id && <p className="mt-2 text-xs text-danger" role="alert">{draftError.text}</p>}
                      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-brand/15 pt-2">
                        <button type="button" className="btn-quiet btn-sm" onClick={() => cancelTeaching(message.id)} disabled={creatingDraftId === message.id}>취소</button>
                        <button type="button" className="btn-primary btn-sm" onClick={() => void createTermsFromBatch(message.id, message.teachingBatch!.drafts)} disabled={creatingDraftId !== null}>{creatingDraftId === message.id ? "추가 중…" : `${message.teachingBatch.drafts.length}개 모두 초안으로 추가`}</button>
                      </div>
                    </div>
                  )}
                  {message.created && message.created.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {message.created.map((term) => (
                        <Link key={term.slug} href={`/edit/${term.slug}`} className="inline-flex rounded-lg border border-brand/25 bg-brand-soft px-2.5 py-1.5 text-xs font-semibold text-brand hover:border-brand/45">
                          {term.title} 편집
                        </Link>
                      ))}
                    </div>
                  )}
                </article>
              </li>
            ))}
            {sending && <li className="flex justify-start"><p className="rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5 text-sm text-ink-3">용어를 찾고 답변하는 중…</p></li>}
          </ol>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      <form onSubmit={(event) => void submit(event)} className="mt-3 flex items-end gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <label htmlFor="chat-question" className="sr-only">용어집에 질문</label>
        <textarea id="chat-question" name="question" autoComplete="off" rows={2} maxLength={20_000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!enabled || sending} placeholder={activeTeachingDraft() ? "빠진 정보나 수정할 내용을 알려주세요…" : "용어를 질문하거나 기존 용어집 내용을 붙여넣으세요…"} className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 text-ink outline-none placeholder:text-ink-3" onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
        <button type="submit" className="btn-primary h-10 shrink-0" disabled={!enabled || sending || !question.trim()}>{sending ? "답변 중…" : "질문"}</button>
      </form>
    </section>
  );
}
