"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HelpTip } from "./help-tip";
import { MarkdownContent } from "./markdown-content";
import { cx } from "@/lib/ui/format";

interface Source { slug: string; title: string; definition: string | null; status: "active" | "deprecated" | "forbidden" }
interface Message { id: number; role: "user" | "assistant"; content: string; sources?: Source[]; failed?: boolean }

const EXAMPLES = ["IT와 SW는 무엇을 뜻해?", "이 용어의 권장 표기는 뭐야?", "관련된 업무 분류까지 설명해 줘"];

export function ChatPanel({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  let nextId = messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || sending || !enabled) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    const userId = nextId++;
    setMessages((current) => [...current, { id: userId, role: "user", content: text }]);
    setQuestion("");
    setSending(true);
    try {
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history }),
      });
      const body = await response.json().catch(() => null) as { answer?: string; sources?: Source[]; error?: { message?: string } } | null;
      setMessages((current) => [...current, {
        id: userId + 1,
        role: "assistant",
        content: response.ok && body?.answer ? body.answer : body?.error?.message || `답변을 받지 못했습니다 (${response.status}).`,
        sources: body?.sources,
        failed: !response.ok,
      }]);
    } catch {
      setMessages((current) => [...current, { id: userId + 1, role: "assistant", content: "네트워크 오류로 답변을 받지 못했습니다.", failed: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-4xl flex-col" aria-labelledby="chat-heading">
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <h2 id="chat-heading" className="text-base font-semibold text-ink">용어 챗봇</h2>
        <HelpTip text="질문에서 관련된 공개 용어를 찾고 그 내용만 AI에 전달합니다. 답변 아래 용어 출처를 직접 확인할 수 있습니다." />
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
              <p className="text-sm font-medium text-ink">용어집에 있는 표기나 약어를 질문해 보세요.</p>
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
                    : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-2" aria-label="답변에 참고한 용어">
                      {message.sources.map((source) => (
                        <Link key={source.slug} href={`/w/${source.slug}`} className="chip max-w-48 truncate hover:border-brand/40 hover:text-brand" title={source.definition || source.title}>
                          {source.title}
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
        <textarea id="chat-question" name="question" autoComplete="off" rows={2} maxLength={4_000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!enabled || sending} placeholder="용어, 약어, 권장 표기를 질문하세요…" className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 text-ink outline-none placeholder:text-ink-3" onKeyDown={(event) => {
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
