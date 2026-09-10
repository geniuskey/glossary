"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HelpTip } from "./help-tip";
import { MarkdownContent } from "./markdown-content";
import { ChatEditCard } from "./chat-edit-card";
import type { ChatEditProposal } from "@/lib/ai/chat-edit-values";
import {
  teachingDraftHasMeaning,
  teachingDraftName,
  type TermTeachingBatch,
  type TermTeachingDraft,
} from "@/lib/ai/teaching-values";
import { cx } from "@/lib/ui/format";
import type { ChatConversationSummary, ChatHistoryResponse, StoredChatMessage } from "@/lib/ai/chat-history-values";

interface Source { slug: string; title: string; definition: string | null; status: "draft" | "active" }
interface Teaching { draft: TermTeachingDraft; ready: boolean }
type Message = StoredChatMessage;

const EXAMPLES = ["IT와 SW는 무엇을 뜻해?", "T/O라는 새 용어를 등록하고 싶어", "AE의 정의를 수정하고 싶어", "AE에 자동노출이라는 별칭을 추가해줘"];

function isLargePastedMessage(content: string): boolean {
  return content.length > 500 || content.split(/\r?\n/).length > 5;
}

export function ChatPanel({ enabled, initialSessionId }: { enabled: boolean; initialSessionId?: string }) {
  const pathname = usePathname();
  const routeSessionId = pathname?.startsWith("/c/") ? pathname.slice(3) : pathname ? null : initialSessionId ?? null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatConversationSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId ?? null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [creatingDraftId, setCreatingDraftId] = useState<number | null>(null);
  const [draftError, setDraftError] = useState<{ id: number; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<{ id: string; text: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const routeSessionRef = useRef(routeSessionId);
  routeSessionRef.current = routeSessionId;
  const busy = sending || deleting || creatingDraftId !== null || editingId !== null;
  let nextId = messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;

  useEffect(() => {
    messagesRef.current = messages;
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  useEffect(() => {
    // 새 답변의 URL 반영과 빈 새 대화는 이미 화면에 반영되어 있다.
    // 뒤로가기/앞으로가기는 URL이 바뀌므로 같은 조회 경로로 복원한다.
    if (!historyLoading && routeSessionId === currentSessionId) {
      setHistoryError(null);
      setActionError(null);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    setActionError(null);
    setDraftError(null);
    const query = routeSessionId ? `?session=${encodeURIComponent(routeSessionId)}` : "";
    void fetch(`/api/v1/chat${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as ChatHistoryResponse | { error?: { message?: string } } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !("sessions" in body)) throw new Error(body && "error" in body ? body.error?.message : undefined);
        if (routeSessionId && !body.conversation) throw new Error("대화를 찾을 수 없습니다. 다른 대화를 선택하거나 새 대화를 시작하세요.");
        setSessions(body.sessions);
        setMessages(body.conversation?.messages ?? []);
        setCurrentSessionId(body.conversation?.id ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHistoryError(error instanceof Error && error.message ? error.message : "대화 기록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [routeSessionId, historyRetry]);

  function openSession(sessionId: string) {
    if (busy || sessionId === routeSessionId) return;
    if (question.trim() && !window.confirm("작성 중인 질문이 있습니다. 질문을 버리고 다른 대화로 이동할까요?")) return;
    setQuestion("");
    window.history.pushState(null, "", `/c/${encodeURIComponent(sessionId)}`);
  }

  function newConversation() {
    if (busy) return;
    if (question.trim() && !window.confirm("작성 중인 질문이 있습니다. 질문을 버리고 새 대화를 시작할까요?")) return;
    resetConversation();
  }

  function resetConversation(replace = false) {
    if (replace) window.history.replaceState(null, "", "/chat");
    else window.history.pushState(null, "", "/chat");
    setCurrentSessionId(null);
    setMessages([]);
    setQuestion("");
    setDraftError(null);
    setHistoryError(null);
    setHistoryLoading(false);
    setActionError(null);
  }

  async function persistMessages(nextMessages: Message[]) {
    if (!currentSessionId) return;
    try {
      const response = await fetch("/api/v1/chat", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId, messages: nextMessages }),
      });
      if (response.ok) {
        const now = new Date().toISOString();
        setSessions((current) => current.map((session) => session.id === currentSessionId
          ? { ...session, updatedAt: now, messageCount: nextMessages.length }
          : session).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      if (!response.ok) throw new Error("대화 저장 실패");
    } catch {
      setActionError("용어 작업은 완료했지만 대화 기록을 저장하지 못했습니다. 재등록 전에 용어 목록을 확인해 주세요.");
    }
  }

  function activeTeachingDraft(): TermTeachingDraft | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.teaching?.draft) return messages[index]!.teaching!.draft;
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy || historyLoading || historyError || !enabled) return;
    const submittedSessionId = routeSessionId;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(-4_000) }));
    const userId = nextId++;
    setMessages((current) => [...current, { id: userId, role: "user", content: text }]);
    setQuestion("");
    setSending(true);
    try {
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history, teachingDraft: activeTeachingDraft(), ...(currentSessionId ? { sessionId: currentSessionId } : {}) }),
      });
      const body = await response.json().catch(() => null) as { sessionId?: string; answer?: string; messages?: Message[]; edit?: ChatEditProposal; sources?: Source[]; teaching?: Teaching; teachingBatch?: TermTeachingBatch; error?: { message?: string; details?: { sessionId?: string } } } | null;
      if (routeSessionRef.current !== submittedSessionId) return;
      const returnedSessionId = body?.sessionId || body?.error?.details?.sessionId;
      if (!currentSessionId && returnedSessionId) {
        const now = new Date().toISOString();
        setCurrentSessionId(returnedSessionId);
        window.history.replaceState(null, "", `/c/${encodeURIComponent(returnedSessionId)}`);
        setSessions((current) => [{ id: returnedSessionId, title: text.replace(/\s+/g, " ").slice(0, 80), createdAt: now, updatedAt: now, messageCount: response.ok ? 2 : 1 }, ...current]);
      } else if (currentSessionId) {
        const now = new Date().toISOString();
        setSessions((current) => current.map((session) => session.id === currentSessionId
          ? { ...session, updatedAt: now, messageCount: session.messageCount + (response.ok ? 2 : 1) }
          : session).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      setMessages((current) => response.ok && body?.messages ? body.messages : [
        ...current.map((message) => message.teaching || message.teachingBatch ? { ...message, teaching: undefined, teachingBatch: undefined } : message),
        {
          id: userId + 1,
          role: "assistant",
          content: response.ok && body?.answer ? body.answer : body?.error?.message || `답변을 받지 못했습니다 (${response.status}).`,
          sources: body?.sources,
          teaching: body?.teaching,
          teachingBatch: body?.teachingBatch,
          edit: body?.edit,
          failed: !response.ok,
        },
      ]);
      setDraftError(null);
    } catch {
      if (routeSessionRef.current === submittedSessionId) {
        setMessages((current) => [...current, { id: userId + 1, role: "assistant", content: "네트워크 오류로 답변을 받지 못했습니다.", failed: true }]);
      }
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
        qualityProfile: "auto",
        nameEn: draft.nameEn,
        nameKo: draft.nameKo,
        fullNameEn: draft.fullNameEn,
        fullNameKo: draft.fullNameKo,
        definitionMd: draft.definitionMd || undefined,
        bodyMd: draft.bodyMd || undefined,
        domain: draft.domain ?? [],
        category: draft.category ?? [],
        surfaces: draft.surfaces ?? [],
      }),
    });
    const body = await response.json().catch(() => null) as {
      term?: { slug?: string; nameEn?: string | null; nameKo?: string | null };
      error?: { message?: string; details?: { formErrors?: string[] } };
    } | null;
    if (!response.ok || !body?.term?.slug) {
      return {
        ok: false,
        error: body?.error?.details?.formErrors?.join(" ") || body?.error?.message || `용어를 추가하지 못했습니다 (${response.status}).`,
      };
    }
    return {
      ok: true,
      term: { slug: body.term.slug, title: body.term.nameKo || body.term.nameEn || teachingDraftName(draft) },
    };
  }

  async function runEdit(edit: ChatEditProposal, action: "apply" | "cancel") {
    if (busy || historyLoading || !currentSessionId) return;
    const submittedSession = routeSessionId;
    setEditingId(edit.id);
    setEditError(null);
    try {
      const response = await fetch("/api/v1/chat/actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId, actionId: edit.id, action }),
      });
      const body = await response.json();
      if (!response.ok || !body.edit) throw new Error(body.error?.message || "작업 결과를 확인하지 못했습니다.");
      if (routeSessionRef.current === submittedSession) setMessages((current) => current.map((message) => message.edit?.id === edit.id ? { ...message, edit: body.edit } : message));
    } catch (error) {
      if (routeSessionRef.current === submittedSession) setEditError({ id: edit.id, text: error instanceof Error && !(error instanceof TypeError) ? error.message : "연결을 확인하고 다시 시도해 주세요. 이미 적용된 수정은 중복 실행되지 않습니다." });
    } finally { setEditingId(null); }
  }

  async function createTermFromDraft(messageId: number, draft: TermTeachingDraft) {
    if (busy || historyLoading) return;
    const sourceMessages = messagesRef.current;
    const sourceSessionId = routeSessionId;
    setCreatingDraftId(messageId);
    setDraftError(null);
    try {
      const result = await postTermDraft(draft);
      if (!result.ok) {
        if (routeSessionRef.current === sourceSessionId) setDraftError({ id: messageId, text: result.error });
        return;
      }
      const current = sourceMessages;
      const nextId = current.reduce((max, message) => Math.max(max, message.id), 0) + 1;
      const nextMessages = [
        ...current.map((message) => message.id === messageId ? { ...message, teaching: undefined } : message),
        {
          id: nextId,
          role: "assistant",
          content: `“${result.term.title}”를 추가했습니다. 정리 상태는 입력된 내용에 따라 자동으로 판정됩니다.`,
          created: [result.term],
        },
      ] satisfies Message[];
      if (routeSessionRef.current === sourceSessionId) {
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
      }
      void persistMessages(nextMessages);
    } catch {
      if (routeSessionRef.current === sourceSessionId) setDraftError({ id: messageId, text: "네트워크 오류로 용어를 추가하지 못했습니다." });
    } finally {
      setCreatingDraftId(null);
    }
  }

  async function createTermsFromBatch(messageId: number, drafts: TermTeachingDraft[]) {
    if (busy || historyLoading) return;
    const sourceMessages = messagesRef.current;
    const sourceSessionId = routeSessionId;
    setCreatingDraftId(messageId);
    setDraftError(null);
    try {
      const results = await Promise.all(drafts.map(async (draft) => {
        try { return await postTermDraft(draft); }
        catch { return { ok: false as const, error: "네트워크 오류: 등록 여부를 용어 목록에서 확인해 주세요." }; }
      }));
      const created = results.flatMap((result) => result.ok ? [result.term] : []);
      const failed = results.flatMap((result, index) => result.ok ? [] : [`${teachingDraftName(drafts[index]!)}: ${result.error}`]);
      if (created.length === 0) {
        if (routeSessionRef.current === sourceSessionId) setDraftError({ id: messageId, text: failed.join(" ") || "추가할 수 있는 용어가 없습니다." });
        return;
      }
      const current = sourceMessages;
      const nextId = current.reduce((max, message) => Math.max(max, message.id), 0) + 1;
      const failureNote = failed.length > 0
        ? `\n\n추가하지 못한 ${failed.length}개 항목:\n${failed.slice(0, 8).map((item) => `- ${item}`).join("\n")}${failed.length > 8 ? `\n- 그 외 ${failed.length - 8}개` : ""}`
        : "";
      const nextMessages = [
        ...current.map((message) => message.id === messageId ? { ...message, teachingBatch: undefined } : message),
        {
          id: nextId,
          role: "assistant",
          content: `${created.length}개 용어를 추가했습니다. 각 용어의 정리 상태는 입력된 내용에 따라 자동으로 판정됩니다.${failureNote}`,
          created,
        },
      ] satisfies Message[];
      if (routeSessionRef.current === sourceSessionId) {
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
      }
      void persistMessages(nextMessages);
    } catch {
      if (routeSessionRef.current === sourceSessionId) setDraftError({ id: messageId, text: "네트워크 오류로 용어를 추가하지 못했습니다." });
    } finally {
      setCreatingDraftId(null);
    }
  }

  function cancelTeaching(messageId: number) {
    if (busy || historyLoading) return;
    const nextMessages = messagesRef.current.map((message) => message.id === messageId ? { ...message, teaching: undefined, teachingBatch: undefined } : message);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    void persistMessages(nextMessages);
    setDraftError(null);
  }

  async function clearConversation() {
    if (busy || historyLoading) return;
    if (!window.confirm("이 대화를 삭제할까요? 삭제한 대화는 복구할 수 없습니다.")) return;
    const deletedSessionId = routeSessionId;
    setDeleting(true);
    setActionError(null);
    try {
      if (currentSessionId) {
        const response = await fetch(`/api/v1/chat?session=${encodeURIComponent(currentSessionId)}`, { method: "DELETE" });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message || "대화를 지우지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        setSessions((current) => current.filter((session) => session.id !== currentSessionId));
      }
      if (routeSessionRef.current === deletedSessionId) resetConversation(true);
    } catch (error) {
      if (routeSessionRef.current === deletedSessionId) setActionError(error instanceof Error && error.message && !(error instanceof TypeError)
        ? error.message : "네트워크 오류로 대화를 지우지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto grid h-[calc(100svh-7rem)] min-h-[28rem] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-3 md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
      <aside className="rounded-xl border border-line bg-panel p-2 md:min-h-0" aria-label="챗봇 대화 기록">
        <button type="button" className="btn-primary w-full" onClick={newConversation} disabled={busy}>새 대화</button>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 md:block md:max-h-[calc(100svh-11rem)] md:space-y-1 md:overflow-y-auto md:pb-0">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/c/${session.id}`}
              prefetch={false}
              className={cx(
                "min-w-48 rounded-lg px-3 py-2 text-left text-xs transition md:block md:w-full md:min-w-0",
                session.id === currentSessionId ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
              )}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openSession(session.id);
              }}
              aria-disabled={busy}
              aria-current={session.id === currentSessionId ? "page" : undefined}
            >
              <span className="block truncate font-medium">{session.title}</span>
              <span className="mt-0.5 block text-[10px] text-ink-3">{new Date(session.updatedAt).toLocaleDateString("ko-KR")} · {session.messageCount}개 메시지</span>
            </Link>
          ))}
          {!historyLoading && sessions.length === 0 && <p className="px-2 py-3 text-center text-xs text-ink-3">저장된 대화가 없습니다.</p>}
        </div>
      </aside>

    <section className="flex min-h-0 min-w-0 flex-col" aria-labelledby="chat-heading">
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <h2 id="chat-heading" className="text-base font-semibold text-ink">용어 챗봇</h2>
        <HelpTip text="용어집 근거로 답하고, 새 용어 등록과 기존 용어의 정의·별칭·분류 수정을 돕습니다. 변경안을 확인하고 적용하면 이력에 남습니다." />
        {messages.length > 0 && <button type="button" className="btn-quiet btn-sm ml-auto" onClick={() => void clearConversation()} disabled={busy || historyLoading}>{deleting ? "삭제 중…" : "대화 지우기"}</button>}
      </div>

      {actionError && <p className="note-danger mb-3" role="alert">{actionError}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-panel-2/35 p-3 sm:p-4" role="log" aria-live="polite" aria-label="용어 챗봇 대화">
        {historyLoading ? (
          <div className="grid min-h-64 place-items-center text-center"><p className="text-sm text-ink-3">대화 기록을 불러오는 중…</p></div>
        ) : historyError ? (
          <div className="grid min-h-64 place-items-center text-center"><div>
            <p className="text-sm text-danger" role="alert">{historyError}</p>
            <button type="button" className="btn-ghost mt-3" onClick={() => { setHistoryLoading(true); setHistoryRetry((value) => value + 1); }}>다시 불러오기</button>
          </div></div>
        ) : !enabled ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <p className="text-sm font-medium text-ink">용어 챗봇이 아직 연결되지 않았습니다.</p>
              <p className="mt-1 text-xs text-ink-3">관리자가 AI 연결을 설정하고 활성화해야 합니다.</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div className="max-w-lg">
              <p className="text-sm font-medium text-ink">도메인 지식을 찾고, 용어를 함께 정리하세요.</p>
              <p className="mt-2 text-xs text-ink-3">용어 질문 · 새 용어 등록 · 정의와 별칭 수정 · 도메인과 업무 분류 정리</p>
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
                    <div className="mt-3 rounded-xl border border-brand/25 bg-brand-soft/45 p-3 text-ink" aria-label="용어 등록안">
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
                        <dd className="max-h-64 overflow-auto whitespace-pre-wrap">{message.teaching.draft.bodyMd || (message.teaching.draft.skipped.body ? "생략" : "—")}</dd>
                        <dt className="text-ink-3">도메인</dt><dd>{message.teaching.draft.domain?.join(", ") || "—"}</dd>
                        <dt className="text-ink-3">업무 분류</dt><dd>{message.teaching.draft.category?.join(", ") || "—"}</dd>
                        <dt className="text-ink-3">추가 표기</dt><dd>{message.teaching.draft.surfaces?.map((surface) => surface.text).join(", ") || "—"}</dd>
                      </dl>
                      {draftError?.id === message.id && <p className="mt-2 text-xs text-danger" role="alert">{draftError.text}</p>}
                      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-brand/15 pt-2">
                        <button type="button" className="btn-quiet btn-sm" onClick={() => cancelTeaching(message.id)} disabled={busy || historyLoading}>취소</button>
                        {message.teaching.ready && <button type="button" className="btn-primary btn-sm" onClick={() => void createTermFromDraft(message.id, message.teaching!.draft)} disabled={busy || historyLoading}>{creatingDraftId === message.id ? "추가 중…" : "용어로 추가"}</button>}
                      </div>
                    </div>
                  )}
                  {message.teachingBatch && (
                    <div className="mt-3 rounded-xl border border-brand/25 bg-brand-soft/45 p-3 text-ink" aria-label="붙여넣은 용어 등록안">
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
                        <button type="button" className="btn-quiet btn-sm" onClick={() => cancelTeaching(message.id)} disabled={busy || historyLoading}>취소</button>
                        <button type="button" className="btn-primary btn-sm" onClick={() => void createTermsFromBatch(message.id, message.teachingBatch!.drafts)} disabled={busy || historyLoading}>{creatingDraftId === message.id ? "추가 중…" : `${message.teachingBatch.drafts.length}개 모두 용어로 추가`}</button>
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
                  {message.edit && <ChatEditCard edit={message.edit} busy={busy || historyLoading} processing={editingId === message.edit.id} error={editError?.id === message.edit.id ? editError.text : undefined} onAction={(action) => void runEdit(message.edit!, action)} />}
                </article>
              </li>
            ))}
            {sending && <li className="flex justify-start"><p className="rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5 text-sm text-ink-3">요청을 해석하고 용어와 변경 내용을 확인하는 중…</p></li>}
          </ol>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      <form onSubmit={(event) => void submit(event)} className="mt-3 flex items-end gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <label htmlFor="chat-question" className="sr-only">용어 질문 또는 생성·수정 요청</label>
        <textarea id="chat-question" name="question" autoComplete="off" rows={2} maxLength={20_000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!enabled || busy || historyLoading || Boolean(historyError)} placeholder={activeTeachingDraft() ? "빠진 정보나 수정할 내용을 알려주세요…" : "용어를 질문하거나 기존 용어집 내용을 붙여넣으세요…"} className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base sm:text-sm leading-5 text-ink outline-none placeholder:text-ink-3" onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
        <button type="submit" className="btn-primary h-10 shrink-0" disabled={!enabled || busy || historyLoading || Boolean(historyError) || !question.trim()}>{sending ? "처리 중…" : "보내기"}</button>
      </form>
    </section>
    </div>
  );
}
